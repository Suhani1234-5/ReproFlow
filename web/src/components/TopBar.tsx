import { NAV_LINKS } from '../content';
import { Button } from './Button';

export function TopBar() {
  return (
    <header className="fixed inset-x-0 top-0 z-50 border-b border-white/5 bg-black/60 backdrop-blur-md">
      <div className="mx-auto flex h-16 w-full max-w-content items-center justify-between gap-6 px-6">
        <a href="#hero" className="focus-ring flex items-center gap-2 rounded-full text-sm font-medium tracking-tight">
          <span aria-hidden="true" className="h-2 w-2 rounded-full bg-accent" />
          ReproFlow
        </a>

        <nav aria-label="Sections" className="hidden items-center gap-8 md:flex">
          {NAV_LINKS.map((link) => (
            <a
              key={link.href}
              href={link.href}
              className="focus-ring rounded-full text-sm text-mist-500 transition-colors hover:text-mist-100"
            >
              {link.label}
            </a>
          ))}
        </nav>

        <Button href="#install">Install</Button>
      </div>
    </header>
  );
}
