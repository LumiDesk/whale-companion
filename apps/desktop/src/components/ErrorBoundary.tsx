import { Component, type ReactNode } from "react";

interface IProps {
  children: ReactNode;
}

interface IState {
  error: Error | null;
}

/** 页面组件抛错时别整窗白屏，至少给一个能重新加载的出口 */
class ErrorBoundary extends Component<IProps, IState> {
  state: IState = { error: null };

  static getDerivedStateFromError(error: Error): IState {
    return { error };
  }

  render() {
    if (this.state.error) {
      return (
        <div className="error-screen">
          <img src="./icons/logo.png" alt="" />
          <h1>界面出了点问题</h1>
          <p>{this.state.error.message}</p>
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => window.location.reload()}
          >
            重新加载
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}

export default ErrorBoundary;
