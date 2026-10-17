import React, { useState } from 'react';
import confetti from 'canvas-confetti';

export default function DemoModal({ isOpen, onClose }) {
  const [formData, setFormData] = useState({
    name: '',
    email: '',
    repoUrl: '',
    message: ''
  });
  const [submitted, setSubmitted] = useState(false);
  const [loading, setLoading] = useState(false);

  if (!isOpen) return null;

  const handleSubmit = (e) => {
    e.preventDefault();
    setLoading(true);

    setTimeout(() => {
      setLoading(false);
      setSubmitted(true);
      try {
        confetti({
          particleCount: 70,
          spread: 70,
          origin: { y: 0.5 }
        });
      } catch (err) {}
    }, 550);
  };

  const handleClose = () => {
    setSubmitted(false);
    onClose();
  };

  return (
    <div className="modal-overlay" onClick={handleClose}>
      <div className="modal-dialog-box" onClick={(e) => e.stopPropagation()}>
        
        {/* Google-Style Modal Header */}
        <div className="modal-header-google">
          <div className="modal-title-wrap">
            <div className="modal-header-icon-badge">
              <i className="bi bi-github"></i>
            </div>
            <div>
              <h4 className="modal-title-main">Explore a Repository</h4>
              <p className="modal-subtitle-text">Transform any public GitHub repository into visual constellations and evolution stories</p>
            </div>
          </div>
          <button 
            type="button" 
            className="modal-close-btn"
            onClick={handleClose}
            title="Close dialog"
            aria-label="Close dialog"
          >
            <i className="bi bi-x-lg"></i>
          </button>
        </div>

        {/* Modal Body */}
        {submitted ? (
          <div className="modal-body-google">
            <div className="text-center py-4">
              <div className="modal-success-icon-wrap mb-3">
                <i className="bi bi-check-lg"></i>
              </div>
              <h4 className="fs-5 fw-bold text-main mb-1">Exploration Session Ready!</h4>
              <p className="text-secondary fs-7 mb-4 px-2">
                Thank you, <strong>{formData.name || 'Developer'}</strong>. GitStory has initialized the visual timeline, constellations, and evolution narrative for <strong>{formData.repoUrl || 'your repository'}</strong>.
              </p>
              <button
                type="button"
                className="btn-modal-submit mx-auto"
                onClick={handleClose}
              >
                <i className="bi bi-check2"></i>
                <span>Launch Explorer</span>
              </button>
            </div>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="modal-form-layout">
            <div className="modal-body-google">
              {/* Header Preview Showcase Card */}
              <div className="modal-banner-card">
                <img 
                  src="/gitstory-logo.png" 
                  alt="GitStory — Visual GitHub Repository Explorer" 
                  className="modal-banner-img"
                  style={{ maxHeight: '70px', width: 'auto', objectFit: 'contain', margin: '0 auto', display: 'block' }}
                />
              </div>

              <div className="row g-2">
                {/* Your Name */}
                <div className="col-6">
                  <div className="google-field-group">
                    <label className="google-field-label">
                      Your Name / Handle <span className="text-danger">*</span>
                    </label>
                    <div className="google-input-box">
                      <i className="bi bi-person google-input-icon"></i>
                      <input
                        type="text"
                        className="google-text-input"
                        placeholder="e.g. octocat / Name"
                        required
                        value={formData.name}
                        onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                      />
                    </div>
                  </div>
                </div>

                {/* Your Email */}
                <div className="col-6">
                  <div className="google-field-group">
                    <label className="google-field-label">
                      Your Email <span className="text-danger">*</span>
                    </label>
                    <div className="google-input-box">
                      <i className="bi bi-envelope google-input-icon"></i>
                      <input
                        type="email"
                        className="google-text-input"
                        placeholder="dev@company.org"
                        required
                        value={formData.email}
                        onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                      />
                    </div>
                  </div>
                </div>

                {/* GitHub Repository */}
                <div className="col-6">
                  <div className="google-field-group">
                    <label className="google-field-label">
                      Target Repository <span className="text-danger">*</span>
                    </label>
                    <div className="google-input-box">
                      <i className="bi bi-github google-input-icon"></i>
                      <input
                        type="text"
                        className="google-text-input"
                        placeholder="owner/repo (e.g. facebook/react)"
                        required
                        value={formData.repoUrl}
                        onChange={(e) => setFormData({ ...formData, repoUrl: e.target.value })}
                      />
                    </div>
                  </div>
                </div>

                {/* Exploration Focus / Notes */}
                <div className="col-6">
                  <div className="google-field-group">
                    <label className="google-field-label">
                      Analysis Focus / Notes
                    </label>
                    <div className="google-input-box">
                      <i className="bi bi-compass google-input-icon"></i>
                      <input
                        type="text"
                        className="google-text-input"
                        placeholder="Timeline replay, constellations, Q&amp;A..."
                        value={formData.message}
                        onChange={(e) => setFormData({ ...formData, message: e.target.value })}
                      />
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Actions Footer - Always Visible & Pinned */}
            <div className="modal-footer-google">
              <button
                type="button"
                className="btn-modal-cancel"
                onClick={handleClose}
              >
                Cancel
              </button>
              <button
                type="submit"
                className="btn-modal-submit"
                disabled={loading}
              >
                <span className="btn-shimmer-sweep"></span>
                {loading ? (
                  <>
                    <span className="spinner-border spinner-border-sm me-1" role="status"></span>
                    <span>Analyzing...</span>
                  </>
                ) : (
                  <>
                    <span>Explore Repository</span>
                    <i className="bi bi-arrow-right"></i>
                  </>
                )}
              </button>
            </div>
          </form>
        )}

      </div>
    </div>
  );
}
