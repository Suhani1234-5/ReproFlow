import { useEffect } from 'react';
import { Features } from './components/Features';
import { Footer } from './components/Footer';
import { Hero } from './components/Hero';
import { Install } from './components/Install';
import { IssuePreview } from './components/IssuePreview';
import { Privacy } from './components/Privacy';
import { RingCursor } from './components/RingCursor';
import { Story } from './components/Story';
import { TopBar } from './components/TopBar';
import { initSmoothScroll } from './lib/smoothScroll';

export function App() {
  useEffect(() => initSmoothScroll(), []);

  return (
    <div className="relative min-h-screen">
      <a
        href="#main"
        className="focus-ring sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[200] focus:rounded-full focus:bg-accent focus:px-4 focus:py-2 focus:text-sm focus:font-medium focus:text-black"
      >
        Skip to content
      </a>

      <RingCursor />
      <TopBar />

      <main id="main" className="pt-16">
        <Hero />
        <Story />
        <Features />
        <Privacy />
        <IssuePreview />
        <Install />
      </main>

      <Footer />
    </div>
  );
}
