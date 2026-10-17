import React, { useState, useRef } from 'react';
import AskTheRepository from './AskTheRepository';
import TimeTravelTimeline from './TimeTravelTimeline';
import ExploreCollaborators from './ExploreCollaborators';
import ExploreCode from './ExploreCode';

export default function TiltedPipeShowcase({ repo = 'facebook/react', onOpenModal }) {
  const [viewMode, setViewMode] = useState('hub'); // 'hub' | 'timeline' | 'collaborators' | 'code'
  const [activeFeature, setActiveFeature] = useState(null); // 'ai' | null
  const [stageTilt, setStageTilt] = useState({ x: 0, y: 0 });
  const containerRef = useRef(null);

  // Dynamic interactive 3D mouse parallax across the entire group
  const handleMouseMove = (e) => {
    if (!containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width - 0.5;
    const y = (e.clientY - rect.top) / rect.height - 0.5;
    setStageTilt({
      x: -(y * 12).toFixed(2),
      y: (x * 14).toFixed(2),
    });
  };

  const handleMouseLeave = () => {
    setStageTilt({ x: 0, y: 0 });
  };

  const BOXES = [
    {
      id: 'timeline',
      title: 'Explore Timeline',
      detail: 'Milestones & Diffs',
      icon: 'bi-clock-history',
      gradient: 'linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%)',
      glow: 'rgba(99, 102, 241, 0.4)',
      accentColor: '#6366f1',
      animName: 'floatBox1',
    },
    {
      id: 'contributor',
      title: 'Explore Collaborators',
      detail: 'Knowledge & Teams',
      icon: 'bi-people-fill',
      gradient: 'linear-gradient(135deg, #06b6d4 0%, #10b981 100%)',
      glow: 'rgba(6, 182, 212, 0.4)',
      accentColor: '#06b6d4',
      animName: 'floatBox2',
    },
    {
      id: 'code',
      title: 'Explore Code',
      detail: 'Co-Change Impact',
      icon: 'bi-diagram-3-fill',
      gradient: 'linear-gradient(135deg, #ec4899 0%, #f43f5e 100%)',
      glow: 'rgba(236, 72, 153, 0.4)',
      accentColor: '#ec4899',
      animName: 'floatBox3',
    },
    {
      id: 'ai',
      title: 'GitStory AI',
      detail: 'Semantic Q&A',
      icon: 'bi-chat-square-quote-fill',
      gradient: 'linear-gradient(135deg, #8b5cf6 0%, #f59e0b 100%)',
      glow: 'rgba(139, 92, 246, 0.4)',
      accentColor: '#8b5cf6',
      animName: 'floatBox4',
    },
  ];

  const scrollToStage = () => {
    requestAnimationFrame(() => {
      const stageEl = document.getElementById('downside-stage');
      const headerEl = document.getElementById('header');
      if (stageEl) {
        const headerH = headerEl ? headerEl.offsetHeight : 80;
        const targetY = stageEl.offsetTop - headerH;
        if (window.__lenis) {
          window.__lenis.scrollTo(targetY, { duration: 0.8 });
        } else {
          window.scrollTo({ top: targetY, behavior: 'smooth' });
        }
      }
    });
  };

  const handleBoxClick = (boxId) => {
    if (boxId === 'timeline') {
      setViewMode('timeline');
      setActiveFeature(null);
      scrollToStage();
    } else if (boxId === 'contributor') {
      setViewMode('collaborators');
      setActiveFeature(null);
      scrollToStage();
    } else if (boxId === 'code') {
      setViewMode('code');
      setActiveFeature(null);
      scrollToStage();
    } else if (boxId === 'ai') {
      setViewMode('ai');
      setActiveFeature(null);
      scrollToStage();
    } else {
      setActiveFeature(boxId);
    }
  };

  if (viewMode === 'timeline') {
    return (
      <div className="apple-stage-wrapper animate-fade-in">
        <TimeTravelTimeline 
          repo={repo} 
          onBack={() => {
            setViewMode('hub');
            scrollToStage();
          }} 
        />
      </div>
    );
  }

  if (viewMode === 'collaborators') {
    return (
      <div className="apple-stage-wrapper animate-fade-in">
        <ExploreCollaborators 
          repo={repo} 
          onBack={() => {
            setViewMode('hub');
            scrollToStage();
          }} 
        />
      </div>
    );
  }

  if (viewMode === 'code') {
    return (
      <div className="apple-stage-wrapper animate-fade-in">
        <ExploreCode 
          repo={repo} 
          onBack={() => {
            setViewMode('hub');
            scrollToStage();
          }} 
        />
      </div>
    );
  }

  if (viewMode === 'ai') {
    return (
      <div className="apple-stage-wrapper animate-fade-in">
        <AskTheRepository 
          repo={repo} 
          onBack={() => {
            setViewMode('hub');
            scrollToStage();
          }} 
        />
      </div>
    );
  }

  return (
    <div 
      className="boxes-3d-stage-wrapper" 
      ref={containerRef}
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
    >
      {/* 4 Separate 3D Solid Extruded Boxes */}
      <div 
        className="boxes-3d-grid"
        style={{
          transform: `rotateX(${10 + Number(stageTilt.x)}deg) rotateY(${Number(stageTilt.y)}deg)`
        }}
      >
        {BOXES.map((box) => (
          <div 
            key={box.id}
            className={`box-3d-item-anchor box-${box.id}`}
            style={{
              '--box-accent': box.gradient,
              '--box-glow': box.glow,
              '--box-color': box.accentColor,
            }}
            onClick={() => handleBoxClick(box.id)}
          >
            {/* The 3D Extruded Cuboid (Complete with Front, Back, Sides, Top, Bottom) */}
            <div className={`cuboid-3d-body ${box.animName}`}>
              
              {/* 1. FRONT FACE (Clean, compact UI with few details) */}
              <div className="cuboid-face cuboid-face-front">
                <div className="cuboid-edge-glow" style={{ background: box.gradient }}></div>
                
                <div className="box-front-header">
                  <div className="box-icon-gem" style={{ background: box.gradient }}>
                    <i className={`bi ${box.icon}`}></i>
                  </div>
                  <span className="box-detail-tag">{box.detail}</span>
                </div>

                <h3 className="box-front-title">{box.title}</h3>

                <button 
                  type="button" 
                  className="box-action-btn"
                  style={{ background: box.gradient }}
                  onClick={(e) => {
                    e.stopPropagation();
                    handleBoxClick(box.id);
                  }}
                >
                  <span>Explore</span>
                  <i className="bi bi-arrow-right-short ms-1"></i>
                </button>
              </div>

              {/* 2. BACK FACE (Completes the box from the back!) */}
              <div className="cuboid-face cuboid-face-back">
                <div className="back-face-core">
                  <div className="back-logo-mark" style={{ color: box.accentColor }}>
                    <i className={`bi ${box.icon}`}></i>
                  </div>
                  <span className="back-label">GitStory 3D</span>
                </div>
              </div>

              {/* 3. TOP FACE */}
              <div className="cuboid-face cuboid-face-top"></div>

              {/* 4. BOTTOM FACE */}
              <div className="cuboid-face cuboid-face-bottom"></div>

              {/* 5. RIGHT SIDE FACE */}
              <div className="cuboid-face cuboid-face-right"></div>

              {/* 6. LEFT SIDE FACE */}
              <div className="cuboid-face cuboid-face-left"></div>

            </div>

            {/* Dynamic Ground Ambient Contact Shadow */}
            <div className="box-ground-shadow" />

          </div>
        ))}
      </div>

      {/* Feature Exploration Modal for other features */}
      {activeFeature && (
        <div className="pipe-feature-modal-backdrop" onClick={() => setActiveFeature(null)}>
          <div className="pipe-feature-modal-window" onClick={(e) => e.stopPropagation()}>
            <div className="pipe-modal-header">
              <div className="d-flex align-items-center gap-2">
                <span className="modal-repo-tag">
                  <i className="bi bi-github me-1"></i> {repo}
                </span>
                <span className="modal-feature-title">
                  {activeFeature === 'code' && 'Explore Code'}
                  {activeFeature === 'ai' && 'Ask the Repository (GitStory AI)'}
                </span>
              </div>
              <button 
                type="button" 
                className="pipe-modal-close-btn"
                onClick={() => setActiveFeature(null)}
                title="Close View"
              >
                <i className="bi bi-x-lg"></i>
              </button>
            </div>

            <div className="pipe-modal-body">
              {activeFeature === 'code' && <ExploreCode repo={repo} onBack={() => setActiveFeature(null)} />}
              {activeFeature === 'ai' && <AskTheRepository repo={repo} />}
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
