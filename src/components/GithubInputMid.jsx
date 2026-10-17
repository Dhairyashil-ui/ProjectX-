import React, { useState, useRef } from 'react';
import { parseAndValidateRepo } from '../services/githubTimelineService';

export default function GithubInputMid({ onSelectRepo, onCompleteAnalysis }) {
  const [repoInput, setRepoInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [validationError, setValidationError] = useState('');
  const inputRef = useRef(null);

  const handleInputChange = (e) => {
    setRepoInput(e.target.value);
    if (validationError) {
      setValidationError('');
    }
  };

  const handleStartAnalysis = (e) => {
    if (e) {
      if (typeof e.preventDefault === 'function') e.preventDefault();
      if (typeof e.stopPropagation === 'function') e.stopPropagation();
    }
    const trimmed = repoInput.trim();
    // Default to 'facebook/react' if user simply hits explore while input is empty
    const target = trimmed || 'facebook/react';
    const validation = parseAndValidateRepo(target);

    if (!validation.isValid) {
      setValidationError(validation.error);
      return;
    }

    setValidationError('');
    if (onSelectRepo) onSelectRepo(validation.fullName);
    if (onCompleteAnalysis) {
      onCompleteAnalysis(validation.fullName);
    }
  };

  return (
    <div className="git-pill-search-container">
      <form 
        className={`git-pill-search-form ${isLoading ? 'is-loading' : ''} ${validationError ? 'has-error' : ''}`}
        onSubmit={handleStartAnalysis}
      >
        {/* Left Magnifying Glass Search Icon */}
        <div className="git-pill-icon-wrap" aria-hidden="true">
          <svg 
            className="git-pill-search-icon" 
            width="20" 
            height="20" 
            viewBox="0 0 24 24" 
            fill="none" 
            stroke="currentColor" 
            strokeWidth="2.2" 
            strokeLinecap="round" 
            strokeLinejoin="round"
          >
            <circle cx="11" cy="11" r="8"></circle>
            <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
          </svg>
        </div>

        {/* Text Input */}
        <input
          ref={inputRef}
          type="text"
          className="git-pill-input"
          placeholder="Enter repository (e.g. facebook/react)"
          value={repoInput}
          onChange={handleInputChange}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              handleStartAnalysis(e);
            }
          }}
          disabled={isLoading}
          autoComplete="off"
          spellCheck="false"
          aria-invalid={!!validationError}
          aria-describedby={validationError ? "git-pill-error-msg" : undefined}
        />

        {/* Explore Button / Round Spinner */}
        <button
          type="submit"
          className={`git-pill-explore-btn ${isLoading ? 'loading-btn' : ''}`}
          onClick={handleStartAnalysis}
          disabled={isLoading}
          title={isLoading ? 'Loading repository...' : 'Explore repository'}
        >
          {isLoading ? (
            <span className="git-round-spinner" aria-label="Loading..." />
          ) : (
            <>
              <span className="git-btn-text">Explore</span>
              <svg 
                className="git-btn-arrow" 
                width="16" 
                height="16" 
                viewBox="0 0 24 24" 
                fill="none" 
                stroke="currentColor" 
                strokeWidth="2.4" 
                strokeLinecap="round" 
                strokeLinejoin="round"
              >
                <line x1="5" y1="12" x2="19" y2="12"></line>
                <polyline points="12 5 19 12 12 19"></polyline>
              </svg>
            </>
          )}
        </button>
      </form>

      {/* Validation Error Feedback Pill */}
      {validationError && (
        <div id="git-pill-error-msg" className="git-pill-validation-error animate-fade-in" role="alert">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="10"></circle>
            <line x1="12" y1="8" x2="12" y2="12"></line>
            <line x1="12" y1="16" x2="12.01" y2="16"></line>
          </svg>
          <span>{validationError}</span>
        </div>
      )}
    </div>
  );
}
