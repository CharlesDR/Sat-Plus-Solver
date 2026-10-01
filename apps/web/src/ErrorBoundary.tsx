import { Component, type ReactNode } from 'react';

interface Props {
  /** What failed, for the message: "the world view". */
  what: string;
  children: ReactNode;
  /** Extra recovery controls, such as exporting the world. */
  recovery?: ReactNode;
  /** Changing it clears the error, e.g. when the user navigates elsewhere. */
  resetKey?: unknown;
}

interface State {
  error?: Error | undefined;
  resetKey?: unknown;
}

/**
 * Catches a render error in one part of the app (M10), so the rest keeps
 * working and the world stays in the store. React needs a class for this.
 */
export class ErrorBoundary extends Component<Props, State> {
  override state: State = { resetKey: this.props.resetKey };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  static getDerivedStateFromProps(props: Props, state: State): Partial<State> | null {
    return props.resetKey !== state.resetKey
      ? { error: undefined, resetKey: props.resetKey }
      : null;
  }

  override render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    return (
      <div className="error crashed" role="alert">
        <p>
          Something went wrong in {this.props.what}: {error.message}
        </p>
        <p>Your world is safe; it is autosaved after every edit.</p>
        <div className="row">
          <button type="button" onClick={() => this.setState({ error: undefined })}>
            Try again
          </button>
          {this.props.recovery}
        </div>
      </div>
    );
  }
}
