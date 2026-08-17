import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Link } from 'react-router-dom';

interface GuidedEmptyStateProps {
  icon: React.ElementType;
  title: string;
  description: string;
  steps?: string[];
  actionLabel?: string;
  actionHref?: string;
  secondaryActionLabel?: string;
  secondaryActionHref?: string;
}

export function GuidedEmptyState({ icon: Icon, title, description, steps, actionLabel, actionHref, secondaryActionLabel, secondaryActionHref }: GuidedEmptyStateProps) {
  return (
    <Card>
      <CardContent className="flex flex-col items-center justify-center py-12 px-6 text-center">
        <div className="p-4 rounded-full bg-muted mb-4">
          <Icon className="h-10 w-10 text-muted-foreground" />
        </div>
        <h3 className="text-lg font-semibold mb-2">{title}</h3>
        <p className="text-muted-foreground max-w-md mb-4">{description}</p>
        {steps && steps.length > 0 && (
          <div className="text-left bg-muted/50 rounded-lg p-4 mb-4 w-full max-w-md">
            <p className="text-sm font-medium mb-2">So geht's:</p>
            <ol className="text-sm text-muted-foreground space-y-1 list-decimal list-inside">
              {steps.map((step, i) => (
                <li key={i}>{step}</li>
              ))}
            </ol>
          </div>
        )}
        <div className="flex flex-wrap gap-2 justify-center">
          {actionLabel && actionHref && (
            <Button asChild data-testid="button-empty-state-action">
              <Link to={actionHref}>{actionLabel}</Link>
            </Button>
          )}
          {secondaryActionLabel && secondaryActionHref && (
            <Button variant="outline" asChild data-testid="button-empty-state-secondary">
              <Link to={secondaryActionHref}>{secondaryActionLabel}</Link>
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
