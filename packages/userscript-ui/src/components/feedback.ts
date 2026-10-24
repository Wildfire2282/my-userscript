import { errorIcon, infoIcon, successIcon, warningIcon } from '../icons';

export type FeedbackVariant = 'info' | 'success' | 'warning' | 'error';

export function feedbackIcon(variant: FeedbackVariant): SVGSVGElement {
  switch (variant) {
    case 'success':
      return successIcon();
    case 'warning':
      return warningIcon();
    case 'error':
      return errorIcon();
    default:
      return infoIcon();
  }
}

export function feedbackRole(variant: FeedbackVariant): 'alert' | 'status' | null {
  if (variant === 'error') return 'alert';
  if (variant === 'warning') return 'status';
  return null;
}
