import { api } from './api';

export type HarnessPhase =
  | 'idle' | 'intake' | 'context' | 'requirements' | 'scaffold' | 'turn' | 'retry' | 'drift' | 'review' | 'checkpoint' | 'paused';

export class HarnessController {
  phase: HarnessPhase = 'idle';
  driftMode: 'warn' | 'pause' = 'warn';
  lastPlan = '';
  onPhase?: (p: HarnessPhase, detail: string) => void;
  onReview?: (summary: string) => void;

  async runIntake(goal: string) {
    this.set('intake', goal);
    await api.slash('note', `intake: ${goal}`);
    this.set('context', 'reading project context');
    const status = await api.slash('status', '');
    this.set('requirements', 'deriving requirements');
    this.set('scaffold', 'ensuring plan.md / agents.md / instructions.txt');
    await api.slash('plan', goal);
    this.set('turn', 'worker turn');
    try {
      const r = await api.chat([
        { role: 'user', content: `Harness turn. Goal: ${goal}. Update plan.md outline and propose next file edits. Status:\n${status.message}` },
      ], 'MiniMax M3.1 Flash');
      this.lastPlan = r.content;
      this.set('drift', 'checking drift');
      const diff = await api.slash('diff', '');
      if ((diff.message || '').length > 20 && this.driftMode === 'pause') {
        this.set('paused', 'drift pause');
        this.onReview?.(diff.message);
        return;
      }
      this.set('review', 'awaiting Accept / Reject / Continue');
      this.onReview?.(r.content);
    } catch (e: any) {
      this.set('retry', 'one retry');
      try {
        const r = await api.chat([{ role: 'user', content: `Retry harness turn: ${goal}` }], 'MiniMax M3.1 Flash');
        this.set('review', 'awaiting Accept / Reject / Continue after retry');
        this.onReview?.(r.content);
      } catch (e2: any) {
        this.set('paused', `paused after one retry: ${e2.message}`);
      }
    }
  }

  async accept() {
    await api.slash('accept', '');
    this.set('checkpoint', 'saving checkpoint');
    await api.slash('checkpoint', '');
    this.set('idle', 'accepted');
  }
  async reject() {
    await api.slash('reject', '');
    this.set('paused', 'rejected');
  }
  async cont() {
    await api.slash('steer', 'continue');
    this.set('idle', 'continue');
  }

  private set(p: HarnessPhase, detail: string) {
    this.phase = p;
    this.onPhase?.(p, detail);
  }
}
