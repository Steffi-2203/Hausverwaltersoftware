import React from 'react';
import { Button } from '@/components/ui/button';
import { AlertTriangle } from 'lucide-react';

interface ErrorBoundaryState {
  hasError: boolean;
  error?: Error;
}

interface ErrorBoundaryProps {
  children: React.ReactNode;
}

export class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error('Error caught by boundary:', error, errorInfo);
  }

  handleReset = () => {
    this.setState({ hasError: false, error: undefined });
    window.location.href = '/';
  };

  handleClearAndReload = () => {
    if ('caches' in window) {
      caches.keys().then((keys: string[]) => Promise.all(keys.map((k: string) => caches.delete(k)))).then(() => {
        window.location.reload();
      });
    } else {
      (window as any).location.reload();
    }
  };

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen flex items-center justify-center bg-background p-4">
          <div className="text-center max-w-md">
            <div className="mx-auto w-16 h-16 rounded-full bg-destructive/10 flex items-center justify-center mb-6">
              <AlertTriangle className="h-8 w-8 text-destructive" />
            </div>
            <h1 className="text-2xl font-bold text-foreground mb-2">
              Etwas ist schiefgelaufen
            </h1>
            <p className="text-muted-foreground mb-6">
              {this.state.error?.message || 'Ein unerwarteter Fehler ist aufgetreten'}
            </p>
            <div className="flex flex-col gap-2">
              <Button onClick={this.handleReset} data-testid="button-error-home">
                Zur Startseite
              </Button>
              <Button 
                variant="outline" 
                onClick={this.handleClearAndReload}
                data-testid="button-error-reload"
              >
                Cache leeren &amp; neu laden
              </Button>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
