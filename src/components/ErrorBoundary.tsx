import { Component, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { Sentry } from '../lib/sentry'

interface Props {
  children: ReactNode
}

interface State {
  hasError: boolean
  error: Error | null
  eventId: string | null
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props)
    this.state = { hasError: false, error: null, eventId: null }
  }

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { hasError: true, error }
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    const eventId = Sentry.captureException(error, {
      extra: { componentStack: errorInfo.componentStack },
    })
    this.setState({ eventId: eventId ?? null })
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-stone-50 dark:bg-gray-950 flex items-center justify-center p-4">
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md p-6 max-w-md w-full text-center">
            <h1 className="text-xl font-bold text-gray-900 dark:text-gray-100 mb-2">
              Something went wrong
            </h1>
            <p className="text-gray-600 dark:text-gray-300 mb-4">
              An unexpected error occurred. Please try again.
            </p>
            {this.state.error && (
              <p className="text-sm text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 p-2 rounded mb-4 font-mono">
                {this.state.error.message}
              </p>
            )}
            <div className="flex gap-2 justify-center">
              <button
                onClick={() => window.location.reload()}
                className="bg-amber-500 text-white px-4 py-2 rounded hover:bg-amber-400 transition-all"
              >
                Reload Page
              </button>
              <Link
                to="/"
                className="bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 px-4 py-2 rounded hover:bg-gray-300 dark:hover:bg-gray-600"
                onClick={() => this.setState({ hasError: false, error: null, eventId: null })}
              >
                Go Home
              </Link>
            </div>
          </div>
        </div>
      )
    }

    return this.props.children
  }
}
