import type { ReactNode } from 'react';

type ButtonVariant = 'primary' | 'ghost';

interface ButtonProps {
  children: ReactNode;
  href?: string;
  variant?: ButtonVariant;
  className?: string;
}

const VARIANTS: Record<ButtonVariant, string> = {
  primary: 'bg-accent text-black hover:bg-accent-soft',
  ghost: 'border border-white/15 text-mist-100 hover:border-white/40 hover:text-white',
};

/** Pill button: an anchor when it navigates, a real button otherwise. */
export function Button({ children, href, variant = 'primary', className }: ButtonProps) {
  const classes = [
    'focus-ring inline-flex items-center justify-center rounded-full px-5 py-2.5 text-sm font-medium transition-colors',
    VARIANTS[variant],
    className ?? '',
  ].join(' ');

  if (href !== undefined) {
    return (
      <a href={href} className={classes}>
        {children}
      </a>
    );
  }

  return (
    <button type="button" className={classes}>
      {children}
    </button>
  );
}
