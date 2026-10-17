import React, { useState, useEffect } from 'react';
import GithubInputMid from './GithubInputMid';

export default function Hero({ onOpenModal, scrolled, onSelectRepo, onCompleteAnalysis }) {
  // Character-by-character typewriter for the top headline
  const [headline, setHeadline] = useState('');
  const [isTypingDone, setIsTypingDone] = useState(false);

  useEffect(() => {
    const fullHeadline = "The intelligence behind every repository";
    let idx = 0;
    const timer = setTimeout(() => {
      const interval = setInterval(() => {
        idx++;
        setHeadline(fullHeadline.slice(0, idx));
        if (idx >= fullHeadline.length) {
          clearInterval(interval);
          setIsTypingDone(true);
        }
      }, 40);
    }, 280);

    return () => clearTimeout(timer);
  }, []);

  return (
    <section id="hero" className={`hero-stage ${scrolled ? 'scrolled' : ''}`}>
      
      {/* Background Stage Canvas (Animated White Cover on Scroll) */}
      <div className="hero-video-wrapper">
        <div className={`hero-white-cover ${scrolled ? 'active' : ''}`}></div>
        <div className={`hero-bottom-fade ${scrolled ? 'active' : ''}`}></div>
      </div>

      {/* Hero Centered Showcase: Top Typography + Mid Input Box */}
      <div className="hero-centered-showcase">
        
        {/* Top Headline: "The intelligence behind every repository" */}
        <div className="hero-top-typography">
          <h1 className="hero-typography-line hero-line-intelligence hero-headline-centered">
            <span>{headline}</span>
            {!isTypingDone && <span className="type-caret" />}
          </h1>
        </div>

        {/* Center Block: Crazy Smooth GitHub URL Input with Animations */}
        <GithubInputMid 
          onOpenModal={onOpenModal} 
          onSelectRepo={onSelectRepo}
          onCompleteAnalysis={onCompleteAnalysis}
        />

      </div>

    </section>
  );
}
