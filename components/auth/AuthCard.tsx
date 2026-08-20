import { Button } from '@/components/ui/Button';
import { InfoTooltip } from '@/components/ui/InfoTooltip';
import { PasswordInput } from '@/components/ui/PasswordInput';

/**
 * The titled block every auth screen opens with.
 *
 * It no longer renders <main> or centres anything — app/(auth)/layout.tsx owns
 * the page. Two nested <main> elements with two centring contexts is what made
 * the sign-in form collapse to a sliver, and it is invalid HTML besides.
 *
 * The h1 is the TASK ("Sign in"), not the product name. The product name is in
 * the layout, where it stays put between screens instead of appearing as the
 * heading on one and vanishing on the next.
 */
export function AuthCard({
  title,
  subtitle,
  children,
  footer,
}: {
  title: string;
  subtitle?: React.ReactNode;
  children: React.ReactNode;
  footer?: React.ReactNode;
}) {
  return (
    <div className="animate-rise">
      <div className="mb-6">
        <h1 className="title-lg">{title}</h1>
        {subtitle && (
          <p className="mt-1.5 text-[12.5px] leading-relaxed text-[var(--muted)]">{subtitle}</p>
        )}
      </div>

      {children}

      {footer && (
        <div className="mt-6 border-t border-[var(--border)] pt-4 text-[12px] text-[var(--muted)]">
          {footer}
        </div>
      )}
    </div>
  );
}

/**
 * One text input, with its label, hint and error wired up.
 *
 * `invalid` drives both the border and aria-invalid, so the failure is never
 * communicated by colour alone.
 */
export function Field({
  label,
  name,
  type = 'text',
  required = true,
  autoComplete,
  defaultValue,
  readOnly,
  hint,
  invalid,
  autoFocus,
}: {
  label: string;
  name: string;
  type?: string;
  required?: boolean;
  autoComplete?: string;
  defaultValue?: string;
  readOnly?: boolean;
  hint?: string;
  invalid?: boolean;
  autoFocus?: boolean;
}) {
  const id = `f-${name}`;
  return (
    <div>
      <label htmlFor={id} className="mb-1.5 flex items-center gap-1.5 text-[11.5px] font-medium text-[var(--foreground)]">
        {label}
        {/* "Optional" means "you may leave this blank" -- meaningless on a
            field that's readOnly, since it's never blank and can't be
            edited either way. AcceptInviteForm's pre-filled, locked email
            field was showing it regardless, which read as "this invite
            doesn't actually need an email," not true. */}
        {!required && !readOnly && <span className="font-normal text-[var(--faint)]">optional</span>}
        {hint && <InfoTooltip text={hint} />}
      </label>
      {(() => {
        const fieldClassName = `w-full rounded-[var(--radius)] border bg-[var(--surface)] px-3 py-2 text-[13px]
          transition-[border-color,box-shadow] duration-[var(--t-fast)] ease-[var(--ease)]
          placeholder:text-[var(--faint)]
          focus:outline-none focus-visible:outline-none
          ${invalid ? 'border-[var(--danger)]' : 'border-[var(--border-strong)] focus:border-[var(--info)]'}
          focus:shadow-[0_0_0_3px_var(--info-tint)]
          ${readOnly ? 'bg-[var(--surface-subtle)] text-[var(--muted)]' : ''}`;
        const shared = {
          id, name, required, autoComplete, defaultValue, readOnly, autoFocus,
          'aria-invalid': invalid || undefined,
        };
        // A real eye toggle, not just type="text" on focus: someone should be
        // able to check what they typed AFTER typing it, without having to
        // keep the field focused -- see docs/BUILD_LOG.md, 21 Aug 2026.
        return type === 'password'
          ? <PasswordInput {...shared} className={fieldClassName} />
          : <input {...shared} type={type} className={fieldClassName} />;
      })()}
    </div>
  );
}

export function SubmitButton({
  pending,
  children,
  pendingLabel = 'Working…',
}: {
  pending: boolean;
  children: React.ReactNode;
  pendingLabel?: string;
}) {
  return (
    <Button
      type="submit"
      variant="primary"
      disabled={pending}
      aria-busy={pending}
      className="h-9 w-full text-[13px]"
    >
      {pending && (
        <span
          aria-hidden="true"
          className="h-3 w-3 animate-spin rounded-full border border-current border-t-transparent opacity-70"
        />
      )}
      {pending ? pendingLabel : children}
    </Button>
  );
}

export function FormError({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <p
      role="alert"
      className="flex items-start gap-2 rounded-[var(--radius)] px-3 py-2 text-[12px]"
      style={{ background: 'var(--score-fail-tint)', color: 'var(--score-fail-text)' }}
    >
      <span aria-hidden="true" className="mt-px shrink-0 font-semibold">!</span>
      <span>{message}</span>
    </p>
  );
}

/** A neutral, non-alarming notice — a revoked membership, a sent email. */
export function FormNotice({ tone = 'info', children }: { tone?: 'info' | 'warn'; children: React.ReactNode }) {
  return (
    <p
      className="rounded-[var(--radius)] px-3 py-2 text-[12px] leading-relaxed"
      style={{
        background: tone === 'warn' ? 'var(--score-average-tint)' : 'var(--info-tint)',
        color: tone === 'warn' ? 'var(--score-average-text)' : 'var(--foreground)',
      }}
    >
      {children}
    </p>
  );
}

/** The one link style used under every auth form. */
export function AuthLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a
      href={href}
      className="rounded-[3px] font-medium text-[var(--foreground)] underline decoration-[var(--border-strong)] underline-offset-2 transition-colors hover:decoration-[var(--foreground)]"
    >
      {children}
    </a>
  );
}
