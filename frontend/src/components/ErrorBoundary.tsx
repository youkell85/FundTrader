import { Component, type ReactNode } from "react";
import { AlertCircle } from "lucide-react";

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  error?: Error;
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error("ErrorBoundary caught an error:", error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }
      return (
        <div className="min-h-screen flex items-center justify-center px-4">
          <div className="max-w-md w-full text-center">
            <AlertCircle className="mx-auto h-12 w-12 text-red-400 mb-4" />
            <h2 className="text-xl font-semibold text-white mb-2">
              页面出现错误
            </h2>
            <p className="text-sm text-white/60 mb-6">
              抱歉，页面加载时遇到了问题。请尝试刷新页面或稍后重试。
            </p>
            <button
              onClick={() => window.location.reload()}
              className="inline-flex items-center justify-center rounded-lg bg-white/10 px-4 py-2 text-sm font-medium text-white hover:bg-white/20 transition-colors"
            >
              刷新页面
            </button>
            {process.env.NODE_ENV === "development" && this.state.error && (
              <pre className="mt-4 text-left text-xs text-red-300 bg-red-900/20 rounded-lg p-3 overflow-auto max-h-60">
                {this.state.error.stack}
              </pre>
            )}
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
