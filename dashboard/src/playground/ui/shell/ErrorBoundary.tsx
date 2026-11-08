// Keeps one broken component from white-screening the page. `silent` renders nothing on failure
// (floating slots); otherwise a visible notice with "Reload this panel" remounts the subtree.
// The boundary only resets on user action, so a render error cannot loop.
import { Component, Fragment } from 'react';
import type { ErrorInfo, ReactNode } from 'react';
import '../../styles/errors.css';
import '../../styles/toasts.css';

interface Props { name: string; silent?: boolean; children?: ReactNode }
interface State { error: Error | null; attempt: number }

const LOG_MAX = 5;
const log: string[] = [];
/** Last few error messages across all boundaries (newest last). */
export function recentErrors(): readonly string[] { return log; }
export function pushError(msg: string) { log.push(msg); if (log.length > LOG_MAX) log.shift(); }

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null, attempt: 0 };
  private logged: Error | null = null;

  static getDerivedStateFromError(error: Error) { return { error }; }

  componentDidCatch(error: Error, info: ErrorInfo) {
    if (this.logged === error) return; // StrictMode / re-entry: log each error once
    this.logged = error;
    pushError(`${this.props.name}: ${error?.message ?? String(error)}`);
    console.error(`[playground] ${this.props.name} crashed`, error, info?.componentStack);
  }

  reload = () => this.setState((s) => ({ error: null, attempt: s.attempt + 1 }));

  copy = () => {
    const text = `${this.props.name}\n${this.state.error?.stack ?? this.state.error?.message ?? ''}`;
    try { void navigator.clipboard?.writeText(text); } catch { /* clipboard unavailable */ }
  };

  render() {
    const { error, attempt } = this.state;
    if (!error) return <Fragment key={attempt}>{this.props.children}</Fragment>;
    if (this.props.silent) return null;
    return (
      <div className="pg-err" role="alert" data-pg-ui>
        <b>{this.props.name} crashed</b>
        <small>{error?.message ?? String(error)}</small>
        <ul className="pg-err-msgs">{log.map((m, i) => <li key={i}>{m}</li>)}</ul>
        <div className="pg-err-row">
          <button onClick={this.reload}>Reload this panel</button>
          <button onClick={this.copy}>Copy error</button>
        </div>
      </div>
    );
  }
}
