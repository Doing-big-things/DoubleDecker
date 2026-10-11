// The agent gateway (spec §6.2). Any worker fits behind these two methods.
import type { AgentEvent, ChangeOp, Plan } from '@decker/deck-model';

export interface Sandbox {
  /** Executes inside the candidate's container (spec §6.3). An agent has no other way to run anything. */
  run(command: string): Promise<{ exitCode: number; output: string }>;
}

export interface WorkPackage {
  changeId: string;
  title: string;
  candidate: number;
  /** Absolute path of the deck root inside the worktree: the agent's only writable location. */
  worktree: string;
  baseCommit: string;
  /** The affected neighborhood as deck text (spec §4.4). */
  deckText: string;
  operations: ChangeOp[];
  /** Absent while planning. */
  plan?: Plan;
  /** The engineer's comment, when this candidate revises an earlier one. */
  revise?: string;
  /** Globs inside the worktree. */
  allowedPaths: string[];
  budget: { minutes: number; turns: number };
}

export interface AgentWorker {
  readonly name: string;
  /**
   * True when the worker's commands were written by the repository's owner, not chosen by a
   * model. Only such a worker may run arbitrary commands on a host sandbox.
   */
  readonly trusted?: boolean;
  /** Read-only: returns a plan through a 'plan' event. */
  plan(pkg: WorkPackage): AsyncIterable<AgentEvent>;
  /** Writes only inside pkg.worktree. Whatever diff is left there is the result. */
  implement(pkg: WorkPackage, sandbox: Sandbox): AsyncIterable<AgentEvent>;
}
