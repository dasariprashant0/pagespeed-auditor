/**
 * Bare shell for the one unauthenticated route. The root layout already owns
 * <html>/<body> and the font variables, so this is only the centering frame --
 * no left rail, no run pill, nothing that would need a session to render.
 */
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return <main className="grid min-h-dvh place-items-center px-4 py-16">{children}</main>;
}
