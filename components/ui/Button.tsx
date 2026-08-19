import Link from 'next/link';

/**
 * One button. Every variant, every size, one definition.
 *
 * Before this there were eleven hand-rolled `rounded-[5px] border px-2.5 py-1`
 * strings across the app, and they had already drifted -- three different
 * paddings, two radii, and two disabled treatments.
 *
 * No colour except `danger`. Score colour is the only saturated thing in this
 * interface; a blue primary button would compete with a reading.
 */
export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
export type ButtonSize = 'sm' | 'md';

const BASE =
  'inline-flex shrink-0 items-center justify-center gap-1.5 rounded-[var(--radius-sm)] ' +
  'font-medium whitespace-nowrap transition-[background-color,border-color,color,box-shadow,transform] ' +
  'duration-[var(--t-fast)] ease-[var(--ease)] active:translate-y-px ' +
  'disabled:pointer-events-none disabled:opacity-45 aria-disabled:pointer-events-none aria-disabled:opacity-45';

const SIZES: Record<ButtonSize, string> = {
  sm: 'h-6 px-2 text-[11px]',
  md: 'h-7.5 px-2.5 text-[12px]',
};

const VARIANTS: Record<ButtonVariant, string> = {
  primary:
    'bg-[var(--foreground)] text-[var(--background)] border border-transparent ' +
    'hover:opacity-90 shadow-[var(--shadow-raised)]',
  secondary:
    'border border-[var(--border-strong)] bg-[var(--surface)] text-[var(--foreground)] ' +
    'hover:bg-[var(--surface-subtle)] shadow-[var(--shadow-raised)]',
  ghost:
    'border border-transparent text-[var(--muted)] ' +
    'hover:bg-[var(--surface-subtle)] hover:text-[var(--foreground)]',
  danger:
    'border border-[var(--danger)] bg-transparent text-[var(--danger)] ' +
    'hover:bg-[var(--danger)] hover:text-white',
};

export function buttonClass(variant: ButtonVariant = 'secondary', size: ButtonSize = 'md', extra = '') {
  return `${BASE} ${SIZES[size]} ${VARIANTS[variant]} ${extra}`;
}

type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
};

export function Button({ variant = 'secondary', size = 'md', className = '', ...rest }: ButtonProps) {
  return <button {...rest} className={buttonClass(variant, size, className)} />;
}

type ButtonLinkProps = React.ComponentProps<typeof Link> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
};

export function ButtonLink({ variant = 'secondary', size = 'md', className = '', ...rest }: ButtonLinkProps) {
  return <Link {...rest} className={buttonClass(variant, size, className)} />;
}
