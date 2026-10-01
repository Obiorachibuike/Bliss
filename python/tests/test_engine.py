"""Synthetic transcript fixtures for unit tests, not Whisper inference tests."""
import math
import threading
import uuid

import pytest
from pydantic import ValidationError

from app.ai.discovery import discover, sentences_of
from app.captions.ass import build_ass, escape, timestamp
from app.config import Config
from app.errors import AppError
from app.faces.tracking import CropPoint, crop_dimensions, interpolate, smooth_centers
from app.models import AnalyzeOptions, Job, RenderSettings, Segment, Transcript, VideoMetadata, Word
from app.repository import Repository
from app.security import safe_filename, validate_id
from app.workers.jobs import JobManager


def transcript_fixture():
    text = [
        'Why do most people make this mistake?',
        'The first lesson is to understand your audience.',
        'For example you can practice explaining one useful idea.',
        'The point is to focus on what people actually need.',
        'I remember when I first started learning this skill.',
        'One day I realized the answer was simpler than I thought.',
        'That is why I believe practice matters more than tools.',
    ]
    segments = []
    for index, sentence in enumerate(text):
        words = [Word(id=f'{index}-{i}', word=token, start=index * 6 + i * 0.5,
                      end=index * 6 + i * 0.5 + 0.4) for i, token in enumerate(sentence.split())]
        segments.append(Segment(id=index, start=words[0].start, end=words[-1].end, text=sentence, words=words))
    return Transcript(language='en', duration=44, segments=segments, model='synthetic-test-fixture')


def test_word_rejects_backwards_and_nonfinite_timing():
    for start, end in [(2, 1), (math.nan, 2), (0, math.inf)]:
        with pytest.raises(ValidationError):
            Word(id='word', word='test', start=start, end=end)


def test_sentence_boundaries_and_local_ranking():
    transcript = transcript_fixture()
    sentences = sentences_of(transcript)
    assert len(sentences) == len(transcript.segments)
    candidates = discover(transcript, uuid.uuid4().hex, AnalyzeOptions(min_duration=10, max_duration=25))
    assert candidates
    assert [c.score for c in candidates] == sorted([c.score for c in candidates], reverse=True)
    for candidate in candidates:
        assert 10 <= candidate.duration <= 25
        assert any(abs(candidate.start_time - max(0, s.start - 0.08)) < 0.001 for s in sentences)
        assert candidate.transcript.endswith(('.', '?', '!'))
        assert candidate.reasons


def test_duration_preferences_are_validated():
    with pytest.raises(ValidationError):
        AnalyzeOptions(min_duration=90, max_duration=20)
    with pytest.raises(ValidationError):
        AnalyzeOptions(ai_mode='api', transcript_consent=False)


def test_caption_timestamps_and_escaping():
    assert timestamp(72.4) == '0:01:12.40'
    assert timestamp(3599.999) == '1:00:00.00'
    assert '\\' not in escape(r'{\pos(0,0)} injected')
    assert '{' not in escape('{injected}')
    settings = RenderSettings(start_time=10, end_time=14,
                              words=[Word(id='1', word='Hello', start=10.25, end=10.8)])
    ass = build_ass(settings)
    assert '0:00:00.25,0:00:00.80,Caption' in ass
    assert 'HELLO' in ass


def test_render_rejects_out_of_range_words_and_odd_dimensions():
    with pytest.raises(ValidationError):
        RenderSettings(start_time=0, end_time=4, width=1081)
    with pytest.raises(ValidationError):
        RenderSettings(start_time=1, end_time=4, words=[Word(id='1', word='invalid', start=0, end=0.5)])


def test_face_smoothing_and_interpolation():
    assert smooth_centers([0, 100, 0], alpha=0.2) == [0, 20, 16]
    assert interpolate([CropPoint(0, 100), CropPoint(2, 200)], 1, 0) == 150
    assert interpolate([], 1, 540) == 540
    assert crop_dimensions(1920, 1080, 1080, 1920) == (606, 1080)


def test_security_helpers():
    with pytest.raises(AppError):
        validate_id('../../etc/passwd')
    assert '/' not in safe_filename('../../my video.mp4')
    assert '\\' not in safe_filename('bad\\name.mp4')


def test_project_persistence_preserves_referenced_source(tmp_path):
    config = Config(data_dir=tmp_path / 'data', model_dir=tmp_path / 'models', runtime='web')
    source = tmp_path / 'original.mp4'
    source.write_bytes(b'explicit-test-fixture-not-a-valid-video')
    metadata = VideoMetadata(filename=source.name, size=source.stat().st_size, width=1920, height=1080,
                             fps=30, duration=44, codec='h264', has_audio=True)
    repo = Repository(config)
    project = repo.create_project(source, metadata)
    repo.save_transcript(project['id'], transcript_fixture())
    restarted = Repository(config)
    assert restarted.get_project(project['id'])['transcript']['language'] == 'en'
    assert (restarted.project_dir(project['id']) / 'project.json').is_file()
    restarted.delete_project(project['id'])
    assert source.exists()
    assert restarted.list_projects() == []


def test_running_job_can_be_cancelled_and_persisted(tmp_path):
    repository = Repository(Config(data_dir=tmp_path / 'data', model_dir=tmp_path / 'models', runtime='web'))
    manager = JobManager(repository)
    started = threading.Event()

    def worker(context):
        started.set()
        context.cancel_event.wait(5)
        context.check_cancelled()

    job = manager.submit('transcription', worker)
    assert started.wait(2)
    manager.cancel(job['id'])
    manager.shutdown()
    assert repository.get_job(job['id'])['status'] == 'cancelled'


def test_interrupted_job_is_failed_on_restart(tmp_path):
    config = Config(data_dir=tmp_path / 'data', model_dir=tmp_path / 'models', runtime='web')
    repo = Repository(config)
    job = Job(id=uuid.uuid4().hex, kind='render', status='running', progress=20)
    repo.save_job(job)
    restarted = Repository(config)
    assert restarted.get_job(job.id)['error']['code'] == 'WORKER_RESTARTED'
