import { HelpCircle } from 'lucide-react';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { helpTexts, HelpTextKey } from '@/lib/helpTexts';

interface InfoTooltipProps {
  /** Either a key from helpTexts or a custom text string */
  text: HelpTextKey | string;
  className?: string;
}

export function InfoTooltip({ text, className }: InfoTooltipProps) {
  // Check if it's a key in helpTexts, otherwise use the text directly
  const tooltipText = text in helpTexts 
    ? helpTexts[text as HelpTextKey] 
    : text;

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <HelpCircle 
          className={`h-4 w-4 text-muted-foreground cursor-help inline-block ml-1 ${className || ''}`} 
        />
      </TooltipTrigger>
      <TooltipContent className="max-w-xs text-sm">
        {tooltipText}
      </TooltipContent>
    </Tooltip>
  );
}
