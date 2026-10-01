"""Real FFmpeg media I/O; supplied caption text is explicitly a test fixture."""
import subprocess
import uuid

import pytest

from app.config import Config
from app.models import Candidate, Job, RenderSettings, Word
from app.repository import Repository
from app.video.media import probe
from app.video.render import render
from app.workers.jobs import JobContext, JobManager


@pytest.mark.integration
def test_ffmpeg_produces_playable_h264_mp4(tmp_path):
    config = Config(data_dir=tmp_path / 'data', model_dir=tmp_path / 'models', runtime='web')
    if not config.ffmpeg or not config.ffprobe:
        pytest.skip('FFmpeg and FFprobe are required for real media integration')
    source = tmp_path / 'sample.mp4'
    subprocess.run([config.ffmpeg, '-hide_banner', '-loglevel', 'error', '-y',
                    '-f', 'lavfi', '-i', 'color=c=0x242034:s=640x360:r=15:d=4',
                    '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000:duration=4',
                    '-c:v', 'libx264', '-threads', '1', '-pix_fmt', 'yuv420p', '-c:a', 'aac',
                    '-shortest', str(source)], check=True, timeout=30)
    repository = Repository(config)
    project = repository.create_project(source, probe(config, source))
    clip = Candidate(id=uuid.uuid4().hex, project_id=project['id'], start_time=0, end_time=3,
                     duration=3, title='Integration test', hook='Test', score=5, reasons=['test fixture'],
                     transcript='Actual rendered captions.', categories=['insight'])
    repository.save_candidates(project['id'], [clip])
    settings = RenderSettings(start_time=0, end_time=3, width=240, height=426, fps=15,
                              bitrate=1, track_faces=False, face_strategy='center', filename='integration-test',
                              words=[Word(id='1', word='Actual', start=0.1, end=0.7),
                                     Word(id='2', word='rendered', start=0.7, end=1.4),
                                     Word(id='3', word='captions.', start=1.4, end=2.3)])
    manager = JobManager(repository)
    context = JobContext(manager, Job(id=uuid.uuid4().hex, kind='render', project_id=project['id'], clip_id=clip.id))
    try:
        export_id = render(config, repository, clip.id, settings, context)
        output = repository.export_path(export_id)
        metadata = probe(config, output)
        assert output.stat().st_size > 1500
        assert metadata.codec == 'h264'
        assert metadata.audio_codec == 'aac'
        assert (metadata.width, metadata.height) == (240, 426)
        assert abs(metadata.duration - 3) < 0.25
        assert repository.get_project(project['id'])['exportCount'] == 1
        subprocess.run([config.ffmpeg, '-v', 'error', '-i', str(output), '-f', 'null', '-'],
                       check=True, capture_output=True, timeout=30)
    finally:
        manager.shutdown()
