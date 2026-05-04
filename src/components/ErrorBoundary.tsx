import { Component, type ReactNode } from "react";

interface Props  { children: ReactNode }
interface State  { error: Error | null }

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: { componentStack: string }) {
    console.error("[ErrorBoundary]", error.message, info.componentStack);
  }

  render() {
    if (this.state.error) {
      return (
        <div className="min-h-screen bg-background flex items-center justify-center p-8 font-mono">
          <div className="border border-destructive/50 bg-destructive/5 p-6 max-w-lg w-full space-y-4">
            <div className="text-destructive text-[10px] font-bold tracking-widest">
              ✕ FATAL UI ERROR
            </div>
            <div className="text-foreground/80 text-xs border-l-2 border-destructive/40 pl-3">
              {this.state.error.message}
            </div>
            <button
              onClick={() => this.setState({ error: null })}
              className="text-[10px] tracking-widest border border-border px-4 py-2 hover:border-primary hover:text-primary transition-colors"
            >
              RETRY
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
