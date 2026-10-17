import React, { useState, useEffect, useRef, useMemo } from 'react';
import { GitStoryAiService } from '../services/gitStoryAiService';
import { parseRepoIdentifier } from '../services/githubTimelineService';

export default function AskTheRepository({ repo = 'facebook/react', onBack }) {
  const { owner, repo: cleanRepo, fullName } = useMemo(() => parseRepoIdentifier(repo), [repo]);

  // AI & Model status
  const [healthStatus, setHealthStatus] = useState({
    status: 'checking',
    model: 'qwen/qwen3.8-27b',
    modelVerified: false,
    groqConfigured: false,
  });

  // Active conversation state
  const [conversations, setConversations] = useState([]);
  const [activeConversationId, setActiveConversationId] = useState(null);
  const [messages, setMessages] = useState([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamingDelta, setStreamingDelta] = useState('');
  const [streamCitations, setStreamCitations] = useState([]);
  const [abortController, setAbortController] = useState(null);

  // User input & suggestions
  const [inputQuery, setInputQuery] = useState('');
  const [errorMessage, setErrorMessage] = useState(null);
  const [showSettingsModal, setShowSettingsModal] = useState(false);
  const [customApiKey, setCustomApiKey] = useState('');
  const [customModel, setCustomModel] = useState('qwen/qwen3.8-27b');
  const [configSaving, setConfigSaving] = useState(false);

  // Summary Studio Modal
  const [showSummaryModal, setShowSummaryModal] = useState(false);
  const [summaryScope, setSummaryScope] = useState('repo');
  const [summaryTarget, setSummaryTarget] = useState('');
  const [summaryLoading, setSummaryLoading] = useState(false);
  const [generatedSummary, setGeneratedSummary] = useState(null);

  const chatBottomRef = useRef(null);

  // Quick-start prompt chips
  const SUGGESTED_PROMPTS = [
    'Explain how this project works and its main capabilities.',
    'Where is authentication or API request handling implemented?',
    'How does data flow from the frontend to the backend?',
    'What are the core dependencies and primary entry points?',
    'Find potential architectural bottlenecks or maintenance concerns.',
  ];

  // Visual Quick Prompt Capability Cards
  const QUICK_PROMPT_CARDS = [
    {
      id: 'arch',
      title: 'Architecture & Entry',
      desc: 'Main modules, component tree & lifecycle',
      icon: 'bi-diagram-3-fill',
      gradient: 'linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%)',
      color: '#8b5cf6',
      prompt: 'Explain high-level project architecture, key modules, and main entry points.',
    },
    {
      id: 'dataflow',
      title: 'Data Flow & APIs',
      desc: 'State management, backend requests & handlers',
      icon: 'bi-arrow-left-right',
      gradient: 'linear-gradient(135deg, #06b6d4 0%, #10b981 100%)',
      color: '#06b6d4',
      prompt: 'Where are API requests, state management, and data flow pipelines implemented?',
    },
    {
      id: 'deps',
      title: 'Dependencies & Stack',
      desc: 'Core manifests, external packages & config',
      icon: 'bi-box-seam-fill',
      gradient: 'linear-gradient(135deg, #f59e0b 0%, #f97316 100%)',
      color: '#f59e0b',
      prompt: 'What are the core dependencies, build setup, and runtime libraries used here?',
    },
    {
      id: 'hotspots',
      title: 'Maintenance Hotspots',
      desc: 'High-churn files, complexity & potential risks',
      icon: 'bi-shield-exclamation',
      gradient: 'linear-gradient(135deg, #ec4899 0%, #f43f5e 100%)',
      color: '#ec4899',
      prompt: 'Find potential architectural bottlenecks, complex logic, or maintenance risks in this repository.',
    },
  ];

  // 1. Initial health check & load conversations
  useEffect(() => {
    let isMounted = true;

    async function init() {
      try {
        const health = await GitStoryAiService.checkHealth();
        if (isMounted) setHealthStatus(health);

        const convs = await GitStoryAiService.listConversations(fullName);
        if (isMounted) {
          setConversations(convs);
          if (convs.length > 0) {
            loadConversation(convs[0].id);
          } else {
            // Start fresh default conversation
            startNewConversation();
          }
        }
      } catch (err) {
        console.warn('[GitStory AI] Init failed:', err.message);
      }
    }

    init();
    return () => { isMounted = false; };
  }, [fullName]);

  // Scroll to bottom on new messages
  useEffect(() => {
    if (chatBottomRef.current) {
      chatBottomRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages, streamingDelta, isStreaming]);

  // Modal background scroll lock
  useEffect(() => {
    const isModalActive = Boolean(showSummaryModal || showSettingsModal);
    if (isModalActive) {
      document.body.classList.add('mini-screen-locked');
      document.documentElement.classList.add('mini-screen-locked');
      if (window.__lenis) window.__lenis.stop();
    } else {
      document.body.classList.remove('mini-screen-locked');
      document.documentElement.classList.remove('mini-screen-locked');
      if (window.__lenis) window.__lenis.start();
    }
    return () => {
      document.body.classList.remove('mini-screen-locked');
      document.documentElement.classList.remove('mini-screen-locked');
    };
  }, [showSummaryModal, showSettingsModal]);

  // Load a specific conversation
  const loadConversation = async (convId) => {
    try {
      setActiveConversationId(convId);
      const conv = await GitStoryAiService.getConversation(convId);
      if (conv && conv.messages) {
        setMessages(conv.messages);
      }
    } catch (err) {
      console.error('[GitStory AI] Failed to load conversation:', err.message);
    }
  };

  // Start a new conversation thread
  const startNewConversation = async () => {
    try {
      const newConv = await GitStoryAiService.createConversation(fullName, 'New Architecture Discussion');
      setConversations(prev => [newConv, ...prev]);
      setActiveConversationId(newConv.id);
      setMessages([
        {
          id: 'welcome-msg',
          role: 'assistant',
          content: `Hello! I am **GitStory AI**, your codebase intelligence assistant running on **Groq LPU** (\`${healthStatus.model || 'qwen/qwen3.8-27b'}\`).\n\nI have inspected the repository tree, manifests, and documentation for **${fullName}**. Ask any question or choose a capability below to begin!`,
          citations: [],
          timestamp: new Date().toISOString(),
        }
      ]);
    } catch (err) {
      console.error('[GitStory AI] Failed to create new conversation:', err.message);
    }
  };

  // Delete an existing conversation
  const handleDeleteConversation = async (convId, e) => {
    e.stopPropagation();
    if (!window.confirm('Are you sure you want to delete this discussion thread?')) return;
    try {
      await GitStoryAiService.deleteConversation(convId);
      setConversations(prev => prev.filter(c => c.id !== convId));
      if (activeConversationId === convId) {
        const remaining = conversations.filter(c => c.id !== convId);
        if (remaining.length > 0) {
          loadConversation(remaining[0].id);
        } else {
          startNewConversation();
        }
      }
    } catch (err) {
      console.error('[GitStory AI] Delete conversation error:', err.message);
    }
  };

  // Execute chat question with streaming
  const handleSendMessage = async (queryText) => {
    const query = (queryText || inputQuery).trim();
    if (!query || isStreaming) return;

    setInputQuery('');
    setErrorMessage(null);

    // Append user query to UI immediately
    const userMsg = {
      id: `usr_${Date.now()}`,
      role: 'user',
      content: query,
      timestamp: new Date().toISOString(),
    };
    setMessages(prev => [...prev, userMsg]);

    setIsStreaming(true);
    setStreamingDelta('');
    setStreamCitations([]);

    const controller = new AbortController();
    setAbortController(controller);

    try {
      await GitStoryAiService.streamChat({
        repo: fullName,
        conversationId: activeConversationId,
        query,
        signal: controller.signal,
        onMetadata: (meta) => {
          if (meta.citations) setStreamCitations(meta.citations);
          if (meta.conversationId && meta.conversationId !== activeConversationId) {
            setActiveConversationId(meta.conversationId);
          }
        },
        onChunk: (delta, accumulated) => {
          setStreamingDelta(accumulated);
        },
        onDone: (fullContent) => {
          const assistantMsg = {
            id: `asst_${Date.now()}`,
            role: 'assistant',
            content: fullContent,
            citations: streamCitations,
            model: healthStatus.model || 'qwen/qwen3.8-27b',
            timestamp: new Date().toISOString(),
          };
          setMessages(prev => [...prev, assistantMsg]);
          setIsStreaming(false);
          setStreamingDelta('');
          setAbortController(null);

          // Refresh conversations list to update titles/timestamps
          GitStoryAiService.listConversations(fullName).then(setConversations).catch(() => {});
        },
        onError: (err) => {
          setErrorMessage(err.message || 'Error communicating with GitStory AI service');
          setIsStreaming(false);
          setStreamingDelta('');
          setAbortController(null);
        },
      });
    } catch (err) {
      if (err.name !== 'AbortError') {
        setErrorMessage(err.message || 'Unexpected streaming failure');
      }
      setIsStreaming(false);
      setAbortController(null);
    }
  };

  // Stop streaming
  const handleStopStreaming = () => {
    if (abortController) {
      abortController.abort();
      setIsStreaming(false);
      if (streamingDelta) {
        setMessages(prev => [
          ...prev,
          {
            id: `asst_${Date.now()}`,
            role: 'assistant',
            content: streamingDelta + ' *(Response stopped by user)*',
            citations: streamCitations,
            timestamp: new Date().toISOString(),
          }
        ]);
        setStreamingDelta('');
      }
      setAbortController(null);
    }
  };

  // Generate on-demand repository summary
  const handleGenerateSummary = async () => {
    setSummaryLoading(true);
    setErrorMessage(null);
    try {
      const summaryResult = await GitStoryAiService.generateSummary({
        repo: fullName,
        scope: summaryScope,
        target: summaryTarget,
      });
      setGeneratedSummary(summaryResult);
    } catch (err) {
      setErrorMessage(err.message || 'Failed to generate repository summary');
    } finally {
      setSummaryLoading(false);
    }
  };

  // Insert generated summary into active conversation
  const handleInsertSummaryIntoChat = () => {
    if (!generatedSummary) return;
    const summaryText = `### Repository Summary: ${generatedSummary.scope.toUpperCase()}\n${generatedSummary.summary}`;
    setMessages(prev => [
      ...prev,
      {
        id: `summary_${Date.now()}`,
        role: 'assistant',
        content: summaryText,
        citations: (generatedSummary.keyFiles || []).map(f => ({
          path: f,
          lineRange: '1-50',
          githubUrl: `https://github.com/${owner}/${cleanRepo}/blob/main/${f}`,
        })),
        timestamp: new Date().toISOString(),
      }
    ]);
    setShowSummaryModal(false);
  };

  // Save custom API key configuration
  const handleSaveConfig = async (e) => {
    e.preventDefault();
    setConfigSaving(true);
    try {
      await GitStoryAiService.updateConfig({
        apiKey: customApiKey,
        model: customModel,
      });
      const health = await GitStoryAiService.checkHealth();
      setHealthStatus(health);
      setShowSettingsModal(false);
      alert('GitStory AI configuration updated successfully!');
    } catch (err) {
      alert(`Configuration update failed: ${err.message}`);
    } finally {
      setConfigSaving(false);
    }
  };

  // Simple Markdown Formatter with code citations & syntax highlighting support
  const renderFormattedMarkdown = (text) => {
    if (!text) return null;

    // Split text into paragraphs / blocks
    const lines = text.split('\n');
    const elements = [];
    let inCodeBlock = false;
    let codeBuffer = [];
    let codeLang = '';

    lines.forEach((line, idx) => {
      if (line.startsWith('```')) {
        if (!inCodeBlock) {
          inCodeBlock = true;
          codeLang = line.replace('```', '').trim() || 'code';
          codeBuffer = [];
        } else {
          inCodeBlock = false;
          const codeSnippet = codeBuffer.join('\n');
          elements.push(
            <div key={`code_${idx}`} className="gitstory-code-block-wrapper">
              <div className="code-block-header">
                <div className="code-window-dots">
                  <span className="dot dot-red"></span>
                  <span className="dot dot-yellow"></span>
                  <span className="dot dot-green"></span>
                </div>
                <span className="code-lang-tag">
                  <i className="bi bi-file-earmark-code me-1 text-primary"></i>
                  {codeLang}
                </span>
                <button
                  type="button"
                  className="code-copy-btn"
                  onClick={(e) => {
                    e.stopPropagation();
                    navigator.clipboard.writeText(codeSnippet);
                    const btn = e.currentTarget;
                    const prevHTML = btn.innerHTML;
                    btn.innerHTML = '<i class="bi bi-check2 text-success me-1"></i> Copied!';
                    setTimeout(() => {
                      btn.innerHTML = prevHTML;
                    }, 2000);
                  }}
                  title="Copy code to clipboard"
                >
                  <i className="bi bi-clipboard me-1"></i> Copy
                </button>
              </div>
              <pre className="gitstory-code-block">
                <code>{codeSnippet}</code>
              </pre>
            </div>
          );
        }
        return;
      }

      if (inCodeBlock) {
        codeBuffer.push(line);
        return;
      }

      // Headings
      if (line.startsWith('### ')) {
        elements.push(<h4 key={`h4_${idx}`} className="ai-markdown-h4">{parseInlineMarkdown(line.slice(4))}</h4>);
        return;
      }
      if (line.startsWith('## ')) {
        elements.push(<h3 key={`h3_${idx}`} className="ai-markdown-h3">{parseInlineMarkdown(line.slice(3))}</h3>);
        return;
      }
      if (line.startsWith('# ')) {
        elements.push(<h2 key={`h2_${idx}`} className="ai-markdown-h2">{parseInlineMarkdown(line.slice(2))}</h2>);
        return;
      }

      // Bullet points
      if (line.trim().startsWith('* ') || line.trim().startsWith('- ')) {
        const bulletText = line.trim().slice(2);
        elements.push(
          <div key={`li_${idx}`} className="ai-markdown-bullet">
            <span className="bullet-dot">•</span>
            <span>{parseInlineMarkdown(bulletText)}</span>
          </div>
        );
        return;
      }

      // Regular paragraph or blank line
      if (!line.trim()) {
        elements.push(<div key={`sp_${idx}`} className="ai-markdown-spacer" />);
      } else {
        elements.push(
          <p key={`p_${idx}`} className="ai-markdown-p">
            {parseInlineMarkdown(line)}
          </p>
        );
      }
    });

    return elements;
  };

  // Helper to parse bold, inline code, and file citations
  const parseInlineMarkdown = (text) => {
    if (!text) return null;

    // First handle [file:line] citations
    const segments = [];
    let lastIndex = 0;
    const citationRegex = /\[([a-zA-Z0-9_\-\.\/]+)(?::([0-9\-L]+))?\]/g;
    let match;

    while ((match = citationRegex.exec(text)) !== null) {
      if (match.index > lastIndex) {
        segments.push({ type: 'text', value: text.substring(lastIndex, match.index) });
      }

      const filePath = match[1];
      const lineSpec = match[2] || '';
      const cleanLineSpec = lineSpec.replace(/^L/, '');
      const githubUrl = `https://github.com/${owner}/${cleanRepo}/blob/main/${filePath}${cleanLineSpec ? `#L${cleanLineSpec}` : ''}`;

      segments.push({
        type: 'citation',
        filePath,
        lineSpec,
        githubUrl,
      });

      lastIndex = citationRegex.lastIndex;
    }

    if (lastIndex < text.length) {
      segments.push({ type: 'text', value: text.substring(lastIndex) });
    }

    // Now format bold and code tokens
    return segments.map((seg, sIdx) => {
      if (seg.type === 'citation') {
        return (
          <a
            key={`cite_${sIdx}`}
            href={seg.githubUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="gitstory-citation-link"
            title={`View ${seg.filePath} on GitHub`}
          >
            <i className="bi bi-file-earmark-code me-1"></i>
            {seg.filePath}{seg.lineSpec ? `:${seg.lineSpec}` : ''}
          </a>
        );
      }

      const inlineTokens = seg.value.split(/(\*\*[^*]+\*\*|`[^`]+`)/g);
      return (
        <React.Fragment key={`seg_${sIdx}`}>
          {inlineTokens.map((tok, tIdx) => {
            if (tok.startsWith('**') && tok.endsWith('**') && tok.length > 4) {
              return <strong key={tIdx} className="ai-markdown-bold">{tok.slice(2, -2)}</strong>;
            }
            if (tok.startsWith('`') && tok.endsWith('`') && tok.length > 2) {
              return <code key={tIdx} className="ai-markdown-inline-code">{tok.slice(1, -1)}</code>;
            }
            return tok;
          })}
        </React.Fragment>
      );
    });
  };

  return (
    <div className="gitstory-ai-stage animate-fade-in" id="gitstory-ai-root">
      <div className="ai-stage-inner-wrapper">

        {/* 1. Header Toolbar */}
        <div className="ai-hub-header-bar d-flex flex-wrap align-items-center justify-content-between gap-3">
          <div className="d-flex align-items-center gap-3">
            {onBack && (
              <button
                type="button"
                className="btn-back-hub"
                onClick={onBack}
                title="Return to 3D Navigation Hub"
              >
                <i className="bi bi-arrow-left me-1"></i>
                <span>3D Hub</span>
              </button>
            )}

            <div className="d-flex align-items-center gap-2">
              <div className="d-flex align-items-center gap-2">
                <img 
                  src="/gitstory-logo.png" 
                  alt="GitStory" 
                  className="ai-official-logo" 
                />
                <span className="ai-brand-pill">AI</span>
              </div>
              <div>
                <div className="d-flex align-items-center gap-2 flex-wrap">
                  <span className="ai-model-badge">
                    <span className="model-pulse-dot"></span>
                    {healthStatus.model || 'qwen/qwen3.8-27b'}
                  </span>
                  <span className="token-optimized-badge" title="High-density token compression active">
                    <i className="bi bi-lightning-charge-fill text-warning me-1"></i>
                    Token-Optimized
                  </span>
                </div>
                <div className="ai-header-subtitle">
                  Inspecting repository: <strong>{fullName}</strong> &bull; Grounded in actual GitHub files &amp; AST
                </div>
              </div>
            </div>
          </div>

          <div className="d-flex align-items-center gap-2">
            <button
              type="button"
              className="btn-ai-action btn-summarize"
              onClick={() => setShowSummaryModal(true)}
              title="Generate Structured Architecture Summary"
            >
              <i className="bi bi-file-earmark-text-fill me-1 text-primary"></i>
              <span>Summarize Repository</span>
            </button>

            <button
              type="button"
              className="btn-ai-action btn-new-thread"
              onClick={startNewConversation}
              title="Start a new discussion thread"
            >
              <i className="bi bi-plus-lg me-1"></i>
              <span>New Thread</span>
            </button>

            <button
              type="button"
              className="btn-ai-action btn-settings"
              onClick={() => setShowSettingsModal(true)}
              title="Configure Groq API Key & Model"
            >
              <i className="bi bi-gear-fill"></i>
            </button>
          </div>
        </div>

        {/* 2. Main Console Layout: Threads Sidebar + Chat Stream */}
        <div className="ai-main-body-split">

          {/* Left Column: Persistent Conversation Threads */}
          <div className="ai-sidebar-col">
            <div className="ai-sidebar-card">
              <div className="sidebar-header d-flex align-items-center justify-content-between mb-2">
                <span className="sidebar-title">
                  <i className="bi bi-clock-history me-1 text-purple"></i>
                  Discussions ({conversations.length})
                </span>
                <button
                  type="button"
                  className="btn-icon-subtle"
                  onClick={startNewConversation}
                  title="Create new thread"
                >
                  <i className="bi bi-plus"></i>
                </button>
              </div>

              <div 
                className="conversations-scroll-list"
                onWheel={(e) => e.stopPropagation()}
                data-lenis-prevent="true"
              >
                {conversations.length === 0 ? (
                  <div className="empty-threads-notice">
                    No prior discussions. Ask a question to begin.
                  </div>
                ) : (
                  conversations.map((c) => (
                    <div
                      key={c.id}
                      className={`conversation-thread-item ${activeConversationId === c.id ? 'active' : ''}`}
                      onClick={() => loadConversation(c.id)}
                    >
                      <div className="d-flex align-items-start justify-content-between gap-2">
                        <div className="thread-title-wrap">
                          <i className="bi bi-chat-text-fill thread-icon"></i>
                          <span className="thread-title" title={c.title || c.id}>
                            {c.title || 'Repository Discussion'}
                          </span>
                        </div>
                        <button
                          type="button"
                          className="btn-delete-thread"
                          onClick={(e) => handleDeleteConversation(c.id, e)}
                          title="Delete thread"
                        >
                          <i className="bi bi-trash"></i>
                        </button>
                      </div>
                      <div className="thread-meta-row">
                        <span>{new Date(c.updatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                        <span>{c.messages ? c.messages.length : 0} msgs</span>
                      </div>
                    </div>
                  ))
                )}
              </div>

              {/* Verified Ground Truth Safeguard Box */}
              <div className="ground-truth-safeguard-box mt-2">
                <div className="safeguard-title">
                  <i className="bi bi-shield-check-fill text-emerald me-1"></i>
                  Ground Truth Safeguards
                </div>
                <div className="safeguard-desc">
                  Every answer retrieves active GitHub source files, line-numbered AST snippets, and manifests. Answers clearly distinguish verified code from inferences.
                </div>
              </div>
            </div>
          </div>

          {/* Right Column: Chat Console & Grounded Stream */}
          <div className="ai-chat-col">
            <div className="ai-chat-console-card">

              {/* Suggested Questions Banner */}
              <div className="ai-suggested-prompts-strip">
                <span className="suggested-heading">
                  <i className="bi bi-stars text-warning me-1"></i>
                  Suggested:
                </span>
                <div className="suggested-chips-flow">
                  {SUGGESTED_PROMPTS.map((prompt, idx) => (
                    <button
                      key={idx}
                      type="button"
                      className="suggested-prompt-chip"
                      onClick={() => handleSendMessage(prompt)}
                      disabled={isStreaming}
                    >
                      {prompt}
                    </button>
                  ))}
                </div>
              </div>

              {/* Error Alert Pill if applicable */}
              {errorMessage && (
                <div className="ai-error-alert d-flex align-items-center justify-content-between">
                  <div>
                    <i className="bi bi-exclamation-triangle-fill text-danger me-2"></i>
                    <span>{errorMessage}</span>
                  </div>
                  <button
                    type="button"
                    className="btn-close-error"
                    onClick={() => setErrorMessage(null)}
                  >
                    <i className="bi bi-x-lg"></i>
                  </button>
                </div>
              )}

              {/* Chat Stream Window */}
              <div 
                className="ai-chat-messages-container"
                onWheel={(e) => e.stopPropagation()}
                data-lenis-prevent="true"
              >
                {messages.map((msg) => (
                  <div
                    key={msg.id}
                    className={`ai-message-row ${msg.role === 'user' ? 'user-side' : 'assistant-side'}`}
                  >
                    <div className="message-bubble-wrapper">
                      <div className="message-meta-strip">
                        <span className="message-author">
                          {msg.role === 'user' ? (
                            <>
                              <i className="bi bi-person-fill text-primary me-1"></i>
                              You
                            </>
                          ) : (
                            <>
                              <img src="/gitstory-logo.png" alt="GitStory" className="ai-message-avatar-logo me-1" />
                              GitStory AI • {msg.model || healthStatus.model || 'qwen/qwen3.8-27b'}
                            </>
                          )}
                        </span>
                        <span className="message-timestamp">
                          {new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </span>
                      </div>

                      {/* Content Body */}
                      <div className="message-content-body">
                        {renderFormattedMarkdown(msg.content)}

                        {msg.id === 'welcome-msg' && messages.length <= 2 && (
                          <div className="ai-welcome-quick-cards-grid mt-3">
                            {QUICK_PROMPT_CARDS.map((card) => (
                              <div
                                key={card.id}
                                className="ai-quick-card"
                                onClick={() => handleSendMessage(card.prompt)}
                                role="button"
                                tabIndex={0}
                                title={card.prompt}
                              >
                                <div className="d-flex align-items-center justify-content-between mb-2">
                                  <div className="quick-card-icon" style={{ background: card.gradient || card.color }}>
                                    <i className={`bi ${card.icon}`}></i>
                                  </div>
                                  <i className="bi bi-arrow-up-right quick-card-arrow"></i>
                                </div>
                                <div className="quick-card-title">{card.title}</div>
                                <div className="quick-card-desc">{card.desc}</div>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>

                      {/* Clickable Citations Drawer if available */}
                      {msg.citations && msg.citations.length > 0 && (
                        <div className="message-citations-drawer mt-2">
                          <div className="citations-header">
                            <i className="bi bi-patch-check-fill text-purple me-1"></i>
                            Grounded Code Evidence ({msg.citations.length} files):
                          </div>
                          <div className="citations-pills-row">
                            {msg.citations.map((c, i) => (
                              <a
                                key={i}
                                href={c.githubUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="citation-pill"
                                title={`Inspect ${c.path} lines ${c.lineRange}`}
                              >
                                <i className="bi bi-file-code me-1 text-primary"></i>
                                <span className="citation-path">{c.path}</span>
                                {c.lineRange && <span className="citation-lines">:{c.lineRange}</span>}
                              </a>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                ))}

                {/* Streaming in progress bubble */}
                {isStreaming && (
                  <div className="ai-message-row assistant-side">
                    <div className="message-bubble-wrapper streaming-bubble">
                      <div className="message-meta-strip">
                        <span className="message-author">
                          <img src="/gitstory-logo.png" alt="GitStory" className="ai-message-avatar-logo me-1" />
                          GitStory AI (Streaming from Groq LPU...)
                        </span>
                        <span className="streaming-pulse-indicator"></span>
                      </div>

                      <div className="message-content-body">
                        {renderFormattedMarkdown(streamingDelta)}
                        <span className="streaming-cursor-caret"></span>
                      </div>

                      {streamCitations.length > 0 && (
                        <div className="message-citations-drawer mt-2">
                          <div className="citations-header">
                            <i className="bi bi-search me-1 text-primary"></i>
                            Inspecting candidate files:
                          </div>
                          <div className="citations-pills-row">
                            {streamCitations.map((c, i) => (
                              <span key={i} className="citation-pill">
                                <i className="bi bi-file-code me-1"></i>
                                {c.path}
                              </span>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                )}

                <div ref={chatBottomRef} />
              </div>

              {/* Input Area */}
              <div className="ai-chat-input-bar">
                <div className="input-box-wrapper d-flex align-items-center gap-2">
                  <input
                    type="text"
                    className="ai-chat-input-field"
                    placeholder={`Ask GitStory AI about ${fullName} architecture, APIs, or files...`}
                    value={inputQuery}
                    onChange={(e) => setInputQuery(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        handleSendMessage(inputQuery);
                      }
                    }}
                    disabled={isStreaming}
                  />

                  {isStreaming ? (
                    <button
                      type="button"
                      className="btn-stop-stream"
                      onClick={handleStopStreaming}
                      title="Stop response generation"
                    >
                      <i className="bi bi-stop-circle-fill me-1"></i>
                      <span>Stop</span>
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="btn-send-ai-query"
                      onClick={() => handleSendMessage(inputQuery)}
                      disabled={!inputQuery.trim()}
                      title="Send query to GitStory AI"
                    >
                      <span>Ask</span>
                      <i className="bi bi-arrow-up-circle-fill ms-1"></i>
                    </button>
                  )}
                </div>

                <div className="input-guarantee-strip d-flex align-items-center justify-content-between mt-2">
                  <div className="guarantee-item">
                    <i className="bi bi-shield-lock-fill text-muted me-1"></i>
                    <span>All questions grounded in live repository AST • Untrusted repo data isolated</span>
                  </div>
                  <div className="guarantee-item token-footprint-info">
                    <i className="bi bi-cpu text-purple me-1"></i>
                    <span>Groq LPU Engine • Minimal Token Footprint</span>
                  </div>
                </div>
              </div>

            </div>
          </div>

        </div>

      </div>

      {/* 3. Summary Studio Modal */}
      {showSummaryModal && (
        <div 
          className="gitstory-modal-overlay animate-fade-in" 
          onClick={() => setShowSummaryModal(false)}
          onWheel={(e) => e.stopPropagation()}
          data-lenis-prevent="true"
        >
          <div 
            className="gitstory-modal-dialog" 
            onClick={(e) => e.stopPropagation()}
            onWheel={(e) => e.stopPropagation()}
            data-lenis-prevent="true"
          >
            <div className="modal-header d-flex align-items-center justify-content-between">
              <div className="d-flex align-items-center gap-2">
                <i className="bi bi-file-earmark-text-fill text-primary fs-5"></i>
                <h5 className="modal-title mb-0">Repository Summary Studio</h5>
              </div>
              <button
                type="button"
                className="btn-close-modal"
                onClick={() => setShowSummaryModal(false)}
              >
                <i className="bi bi-x-lg"></i>
              </button>
            </div>

            <div className="modal-body py-3">
              <div className="mb-3">
                <label className="form-label-dark">Select Summary Scope:</label>
                <div className="scope-buttons-grid">
                  {[
                    { id: 'repo', label: 'Whole Repository', icon: 'bi-box-seam' },
                    { id: 'architecture', label: 'System Architecture', icon: 'bi-diagram-3' },
                    { id: 'api', label: 'API & Backend', icon: 'bi-hdd-network' },
                    { id: 'data', label: 'Database & Data Flow', icon: 'bi-database' },
                    { id: 'directory', label: 'Specific Directory', icon: 'bi-folder' },
                    { id: 'file', label: 'Single File Deep Dive', icon: 'bi-file-code' },
                    { id: 'changes', label: 'Recent Changes', icon: 'bi-git' },
                  ].map((s) => (
                    <button
                      key={s.id}
                      type="button"
                      className={`scope-pill-btn ${summaryScope === s.id ? 'active' : ''}`}
                      onClick={() => setSummaryScope(s.id)}
                    >
                      <i className={`bi ${s.icon} me-1`}></i>
                      {s.label}
                    </button>
                  ))}
                </div>
              </div>

              {(summaryScope === 'directory' || summaryScope === 'file') && (
                <div className="mb-3">
                  <label className="form-label-dark">
                    {summaryScope === 'directory' ? 'Directory Target (e.g. src or packages/react):' : 'File Target (e.g. package.json or src/index.js):'}
                  </label>
                  <input
                    type="text"
                    className="form-control-dark"
                    placeholder={summaryScope === 'directory' ? 'src' : 'package.json'}
                    value={summaryTarget}
                    onChange={(e) => setSummaryTarget(e.target.value)}
                  />
                </div>
              )}

              <button
                type="button"
                className="btn-generate-summary w-100 py-2 mb-3"
                onClick={handleGenerateSummary}
                disabled={summaryLoading}
              >
                {summaryLoading ? (
                  <>
                    <span className="spinner-border spinner-border-sm me-2" role="status"></span>
                    Synthesizing Ground Truth Evidence...
                  </>
                ) : (
                  <>
                    <i className="bi bi-lightning-charge-fill me-1"></i>
                    Generate Structured Summary
                  </>
                )}
              </button>

              {/* Summary Preview Box */}
              {generatedSummary && (
                <div className="generated-summary-preview-card">
                  <div className="d-flex align-items-center justify-content-between mb-2">
                    <span className="preview-title">
                      <i className="bi bi-check-circle-fill text-emerald me-1"></i>
                      Generated Summary ({generatedSummary.scope})
                    </span>
                    {generatedSummary.isCached && (
                      <span className="cached-badge">
                        <i className="bi bi-hdd-fill me-1"></i> Cached Revision
                      </span>
                    )}
                  </div>
                  <div className="summary-scroll-content">
                    {renderFormattedMarkdown(generatedSummary.summary)}
                  </div>
                  <div className="d-flex justify-content-end gap-2 mt-3">
                    <button
                      type="button"
                      className="btn-secondary-action"
                      onClick={() => {
                        navigator.clipboard.writeText(generatedSummary.summary);
                        alert('Summary copied to clipboard!');
                      }}
                    >
                      <i className="bi bi-clipboard me-1"></i> Copy
                    </button>
                    <button
                      type="button"
                      className="btn-primary-action"
                      onClick={handleInsertSummaryIntoChat}
                    >
                      <i className="bi bi-chat-dots-fill me-1"></i> Insert into Discussion
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* 4. Configuration & Settings Modal */}
      {showSettingsModal && (
        <div 
          className="gitstory-modal-overlay animate-fade-in" 
          onClick={() => setShowSettingsModal(false)}
          onWheel={(e) => e.stopPropagation()}
          data-lenis-prevent="true"
        >
          <div 
            className="gitstory-modal-dialog settings-dialog" 
            onClick={(e) => e.stopPropagation()}
            onWheel={(e) => e.stopPropagation()}
            data-lenis-prevent="true"
          >
            <div className="modal-header d-flex align-items-center justify-content-between">
              <div className="d-flex align-items-center gap-2">
                <i className="bi bi-gear-fill text-purple fs-5"></i>
                <h5 className="modal-title mb-0">GitStory AI Engine Settings</h5>
              </div>
              <button
                type="button"
                className="btn-close-modal"
                onClick={() => setShowSettingsModal(false)}
              >
                <i className="bi bi-x-lg"></i>
              </button>
            </div>

            <form onSubmit={handleSaveConfig} className="modal-body py-3">
              <div className="mb-3">
                <label className="form-label-dark">Groq Model Identifier:</label>
                <input
                  type="text"
                  className="form-control-dark"
                  value={customModel}
                  onChange={(e) => setCustomModel(e.target.value)}
                  placeholder="qwen/qwen3.8-27b"
                  required
                />
                <div className="form-text text-muted">
                  Configured model: <code>qwen/qwen3.8-27b</code> on Groq LPU.
                </div>
              </div>

              <div className="mb-3">
                <label className="form-label-dark">Update Groq API Key:</label>
                <input
                  type="password"
                  className="form-control-dark"
                  placeholder="gsk_..."
                  value={customApiKey}
                  onChange={(e) => setCustomApiKey(e.target.value)}
                />
                <div className="form-text text-muted">
                  API keys are stored securely on the backend server environment and never exposed to the client bundle.
                </div>
              </div>

              <div className="settings-engine-status-box mb-3">
                <div className="d-flex align-items-center justify-content-between mb-1">
                  <span>Backend Status:</span>
                  <strong className={healthStatus.groqConfigured ? 'text-success' : 'text-danger'}>
                    {healthStatus.groqConfigured ? 'Configured' : 'Missing Key'}
                  </strong>
                </div>
                <div className="d-flex align-items-center justify-content-between">
                  <span>Model Verified on Groq:</span>
                  <strong className={healthStatus.modelVerified ? 'text-success' : 'text-warning'}>
                    {healthStatus.modelVerified ? 'Active & Verified' : 'Checking / Unverified'}
                  </strong>
                </div>
              </div>

              <div className="d-flex justify-content-end gap-2">
                <button
                  type="button"
                  className="btn-secondary-action"
                  onClick={() => setShowSettingsModal(false)}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="btn-primary-action"
                  disabled={configSaving}
                >
                  {configSaving ? 'Saving...' : 'Save Configuration'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

    </div>
  );
}
