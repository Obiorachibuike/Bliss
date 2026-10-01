import { Clapperboard, Code2, HardDrive, LockKeyhole, ArrowUpRight, Check, Circle } from 'lucide-react';
import './foundation.css';

const planUrl = 'https://github.com/Obiorachibuike/Bliss/blob/arena/01a0f65d-bliss/docs/IMPLEMENTATION_PLAN.md';
const checklistUrl = 'https://github.com/Obiorachibuike/Bliss/blob/arena/01a0f65d-bliss/docs/RELEASE_CHECKLIST.md';

/** Phase-one status surface. This deliberately does not simulate the unfinished workflow. */
export function ClipShipApp() {
  return <div className="foundation-app min-h-screen">
    <header className="foundation-header">
      <a className="foundation-logo" href="#main" aria-label="ClipShip home"><span><Clapperboard size={21} /></span>ClipShip</a>
      <span className="foundation-badge"><Code2 size={14} /> Development build</span>
    </header>
    <main id="main" className="foundation-main">
      <div className="foundation-eyebrow">YOUR FOOTAGE. YOUR CONTROL.</div>
      <h1>Great stories.<br /><span>Ready to be clipped.</span></h1>
      <p className="foundation-intro">Turn long videos into publish-ready short clips — privately, locally, and intelligently.</p>
      <section className="foundation-notice" aria-labelledby="draft-title">
        <span className="foundation-notice-icon"><Code2 size={22} /></span>
        <div><h2 id="draft-title">Implementation draft</h2><p>The workspace and media-engine modules are in place. The clipping interface, API routes and desktop bridge are not connected yet. This build cannot import, analyze or export a recording from the UI.</p></div>
      </section>
      <div className="foundation-grid">
        <section className="foundation-card"><span className="foundation-card-icon"><HardDrive size={22} /></span><h2>Local by design</h2><p>The desktop architecture is designed to keep source footage, transcripts and rendered clips on your computer. Local models require explicit installation.</p><div className="foundation-card-footer"><LockKeyhole size={14} /> No upload workflow is exposed in this draft</div></section>
        <section className="foundation-card"><span className="foundation-card-icon"><Code2 size={22} /></span><h2>Building the real workflow</h2><ul className="foundation-checklist"><li><Check size={16} /> Typed workspace & processing modules</li><li><Circle size={13} /> API & native desktop integration</li><li><Circle size={13} /> Review, edit & export interface</li><li><Circle size={13} /> End-to-end & platform verification</li></ul></section>
      </div>
      <div className="foundation-links"><a href={planUrl} target="_blank" rel="noreferrer">Implementation plan <ArrowUpRight size={16} /></a><a href={checklistUrl} target="_blank" rel="noreferrer">Release checklist <ArrowUpRight size={16} /></a></div>
      <p className="foundation-disclaimer">The future browser workflow will process explicitly consented uploads on its hosting server. Browser processing is not on-device desktop processing.</p>
    </main>
    <footer className="foundation-footer">ClipShip <span>Foundation · v0.1.0</span></footer>
  </div>;
}
