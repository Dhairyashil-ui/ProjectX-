import React, { useState, useEffect } from 'react';
import Lenis from 'lenis';
import Navbar from './components/Navbar';
import Hero from './components/Hero';
import TiltedPipeShowcase from './components/TiltedPipeShowcase';
import DemoModal from './components/DemoModal';

export default function App() {
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const [analyzedRepo, setAnalyzedRepo] = useState('facebook/react');
  const [hasExplored, setHasExplored] = useState(false);
  const [isZoomedOut, setIsZoomedOut] = useState(false);

  useEffect(() => {
    // 1. Initialize Lenis Buttery Smooth Momentum Scrolling
    const lenis = new Lenis({
      duration: 1.15,
      easing: (t) => Math.min(1, 1.001 - Math.pow(2, -10 * t)),
      orientation: 'vertical',
      gestureOrientation: 'vertical',
      smoothWheel: true,
      wheelMultiplier: 1.0,
      touchMultiplier: 1.2,
      infinite: false,
    });

    window.__lenis = lenis;

    let animId;
    function raf(time) {
      lenis.raf(time);
      animId = requestAnimationFrame(raf);
    }
    animId = requestAnimationFrame(raf);

    // 2. Adaptive Scroll Transition Handling
    const handleScroll = () => {
      const intelligenceEl = document.querySelector('.hero-line-intelligence') || document.querySelector('.hero-headline-centered');
      const whiteSectionEl = document.querySelector('.stats-strip-white') || document.getElementById('downside-stage');

      if (intelligenceEl && whiteSectionEl) {
        const intelRect = intelligenceEl.getBoundingClientRect();
        const whiteRect = whiteSectionEl.getBoundingClientRect();

        setScrolled((prev) => {
          if (prev) {
            return (whiteRect.top <= intelRect.bottom + 45) || (intelRect.bottom <= 85);
          } else {
            return (whiteRect.top <= intelRect.bottom + 25) || (intelRect.bottom <= 72);
          }
        });
      } else {
        const threshold = window.innerHeight * 0.45;
        setScrolled(window.scrollY >= threshold);
      }
    };

    lenis.on('scroll', handleScroll);
    window.addEventListener('resize', handleScroll, { passive: true });
    handleScroll();

    return () => {
      cancelAnimationFrame(animId);
      lenis.destroy();
      window.__lenis = null;
      window.removeEventListener('resize', handleScroll);
    };
  }, []);

  // Lock page scrolling when user enters app first until explore is clicked
  useEffect(() => {
    if (!hasExplored) {
      document.body.classList.add('initial-locked');
      document.documentElement.classList.add('initial-locked');
      if (window.__lenis) {
        window.__lenis.stop();
      }
    } else {
      document.body.classList.remove('initial-locked');
      document.documentElement.classList.remove('initial-locked');
      if (window.__lenis && !isModalOpen) {
        window.__lenis.start();
      }
    }
    return () => {
      document.body.classList.remove('initial-locked');
      document.documentElement.classList.remove('initial-locked');
    };
  }, [hasExplored, isModalOpen]);

  useEffect(() => {
    if (window.__lenis && hasExplored) {
      if (isModalOpen) {
        window.__lenis.stop();
      } else {
        window.__lenis.start();
      }
    }
  }, [isModalOpen, hasExplored]);

  // Instantly scroll downside until the white background reaches the top header,
  // bringing the 4 separate 3D boxes directly into the middle of the page.
  const handleCompleteAnalysis = (repoName) => {
    if (repoName) {
      setAnalyzedRepo(repoName);
    }
    setHasExplored(true);

    // 1. Immediately unlock scrolling & force reflow
    document.body.classList.remove('initial-locked');
    document.documentElement.classList.remove('initial-locked');
    void document.body.offsetHeight;

    if (window.__lenis) {
      window.__lenis.start();
      window.__lenis.resize();
    }

    // 2. Perform smooth auto-scroll to the 3D showcase stage
    const performAutoScroll = () => {
      const downsideStage = document.getElementById('downside-stage');
      const headerEl = document.getElementById('header');
      const headerHeight = headerEl ? headerEl.offsetHeight : 65;

      let targetScrollY = 0;
      if (downsideStage) {
        const stageTop = downsideStage.getBoundingClientRect().top + window.pageYOffset;
        targetScrollY = Math.max(0, stageTop - headerHeight);
      } else {
        const heroEl = document.getElementById('hero');
        const heroHeight = heroEl ? heroEl.offsetHeight : window.innerHeight;
        targetScrollY = Math.max(0, heroHeight - headerHeight);
      }

      if (window.__lenis) {
        window.__lenis.start();
        window.__lenis.resize();
        window.__lenis.scrollTo(targetScrollY, {
          duration: 1.15,
          easing: (t) => Math.min(1, 1.001 - Math.pow(2, -10 * t)),
        });
      }

      window.scrollTo({
        top: targetScrollY,
        behavior: 'smooth',
      });
    };

    // Execute immediately, on next animation frame, and after DOM paint
    performAutoScroll();
    requestAnimationFrame(() => {
      if (window.__lenis) {
        window.__lenis.resize();
      }
      performAutoScroll();
    });
    setTimeout(performAutoScroll, 60);
    setTimeout(performAutoScroll, 180);
  };

  return (
    <div className="gitstory-app-root">
      {/* 1. Header (Adaptive scroll transition) */}
      <Navbar scrolled={scrolled} />
      
      <main id="main">
        {/* Hero Stage with animated white cover & smooth transitions */}
        <Hero 
          scrolled={scrolled} 
          onOpenModal={() => setIsModalOpen(true)}
          onSelectRepo={(r) => setAnalyzedRepo(r)}
          onCompleteAnalysis={handleCompleteAnalysis}
        />

        {/* =========================================================
            3D TILTED PIPE SHOWCASE: 4 ZOOMOUT OPTIONS
            1. Explore Timeline
            2. Explore Contributor
            3. Explore Code
            4. GitStory AI
            Downside page covers half "the intelligence..." behind
            ========================================================= */}
        <section 
          id="downside-stage" 
          className="stats-strip-white downside-showcase-stage"
        >
          <TiltedPipeShowcase 
            repo={analyzedRepo} 
            isZoomedOut={isZoomedOut}
            onOpenModal={() => setIsModalOpen(true)}
          />
        </section>
      </main>

      {/* Interactive Demo Modal Dialog */}
      <DemoModal 
        isOpen={isModalOpen} 
        onClose={() => setIsModalOpen(false)} 
      />
    </div>
  );
}
