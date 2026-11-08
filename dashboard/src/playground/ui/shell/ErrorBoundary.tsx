// Keeps one broken component from white-screening the page. `silent` renders nothing on failure
// (floating slots); otherwise a small notice with a Retry button takes the component's place.
import { Component } from 'react';
import type { ErrorInfo, ReactNode } from 'react';
import '../../styles/errors.css';

interface Props { name: string; silent?: boolean; children?: ReactNode }

export class ErrorBoundary extends Component<Props, { error: Error | null }> {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error) { return { error }; }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(`[playground] ${this.props.name} crashed`, error, info.componentStack);
  }

  render() {
    if (!this.state.error) return this.props.children;
    if (this.props.silent) return null;
    return (
      <div className="pg-err" role="alert" data-pg-ui>
        <b>{this.props.name} crashed</b>
        <small>{this.state.error.message}</small>
        <button onClick={() => this.setState({ error: null })}>Retry</button>
      </div>
    );
  }
}
