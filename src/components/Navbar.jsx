import React, { useState, useEffect } from 'react';

export default function Navbar({ scrolled: externalScrolled }) {
  const [internalScrolled, setInternalScrolled] = useState(false);
  const scrolled = externalScrolled !== undefined ? externalScrolled : internalScrolled;

  useEffect(() => {
    const handleScroll = () => {
      const intelligenceEl = document.querySelector('.hero-line-intelligence') || document.querySelector('.hero-headline-centered');
      const whiteSectionEl = document.querySelector('.stats-strip-white') || document.getElementById('counts');

      if (intelligenceEl && whiteSectionEl) {
        const intelRect = intelligenceEl.getBoundingClientRect();
        const whiteRect = whiteSectionEl.getBoundingClientRect();
        setInternalScrolled((prev) => {
          if (prev) {
            return (whiteRect.top <= intelRect.bottom + 45) || (intelRect.bottom <= 85);
          } else {
            return (whiteRect.top <= intelRect.bottom + 25) || (intelRect.bottom <= 72);
          }
        });
      } else {
        setInternalScrolled(window.scrollY >= (window.innerHeight * 0.5 + 30));
      }
    };

    window.addEventListener('scroll', handleScroll, { passive: true });
    window.addEventListener('resize', handleScroll, { passive: true });
    handleScroll();
    return () => {
      window.removeEventListener('scroll', handleScroll);
      window.removeEventListener('resize', handleScroll);
    };
  }, []);

  const scrollToTop = () => {
    if (window.__lenis) {
      window.__lenis.scrollTo(0, { duration: 1.15 });
    } else {
      window.scrollTo({
        top: 0,
        behavior: 'smooth'
      });
    }
  };

  return (
    <header id="header" className={`fixed-top premium-topbar ${scrolled ? 'header-scrolled' : ''}`}>
      <div className="container d-flex align-items-center justify-content-between">
        
        {/* GitStory 3D Premium Logo */}
        <div className="logo">
          <a 
            href="#hero" 
            onClick={(e) => { e.preventDefault(); scrollToTop(); }}
            className="logo-anchor"
            title="GitStory — Visual GitHub Repository Explorer"
          >
            <img 
              src="/gitstory-logo.png" 
              alt="GitStory — Visual GitHub Repository Explorer" 
              className="trio-header-logo"
            />
          </a>
        </div>

      </div>
    </header>
  );
}
