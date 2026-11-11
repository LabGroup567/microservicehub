import { Component } from 'react';

/** Shows a friendly screen instead of a blank page when something crashes. */
export default class ErrorBoundary extends Component {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error) {
    console.error('UI error:', error);
  }

  render() {
    if (!this.state.failed) return this.props.children;

    return (
      <div className="pg pg-narrow">
        <div className="empty">
          <h3>Something went wrong</h3>
          <p>The page hit an unexpected problem. Your data is safe.</p>
          <button className="btn" onClick={() => window.location.assign('/')}>
            Back to home
          </button>
        </div>
      </div>
    );
  }
}
