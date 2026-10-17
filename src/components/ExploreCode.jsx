import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
  fetchCoChangeAnalytics,
  filterCoChangeGraph,
} from '../services/coChangeAnalyticsService';
import { parseRepoIdentifier } from '../services/githubTimelineService';

export default function ExploreCode({ repo = 'facebook/react', onBack }) {
  const [rawGraphData, setRawGraphData] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [loadingProgress, setLoadingProgress] = useState({ phase: 'starting', loaded: 0, total: 100 });
  const [errorMessage, setErrorMessage] = useState(null);
  const [errorType, setErrorType] = useState(null);
  const [tokenInput, setTokenInput] = useState('');

  // Active view tab: 'graph' | 'clusters' | 'activity'
  const [activeTab, setActiveTab] = useState('graph');

  // Filters
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedDirectory, setSelectedDirectory] = useState('all');
  const [selectedClusterId, setSelectedClusterId] = useState('all');
  const [minSharedCommits, setMinSharedCommits] = useState(1);
  const [excludeBroadCommits, setExcludeBroadCommits] = useState(true);

  // Selections
  const [selectedNodeId, setSelectedNodeId] = useState(null);
  const [hoveredNodeId, setHoveredNodeId] = useState(null);
  const [selectedEdgeId, setSelectedEdgeId] = useState(null);
  const [selectedClusterDetails, setSelectedClusterDetails] = useState(null);

  const activeFocusId = selectedNodeId || hoveredNodeId;

  // SVG Pan & Zoom
  const [zoomLevel, setZoomLevel] = useState(1.0);
  const [panOffset, setPanOffset] = useState({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState(false);
  const [panStart, setPanStart] = useState({ x: 0, y: 0 });
  const svgRef = useRef(null);

  const parsedRepo = useMemo(() => parseRepoIdentifier(repo), [repo]);
  const fullName = parsedRepo.fullName;

  // 1. Fetch Real Co-Change Repository Analytics
  const loadData = async (forceRefresh = false) => {
    setIsLoading(true);
    setErrorMessage(null);
    setErrorType(null);

    try {
      const data = await fetchCoChangeAnalytics(repo, {
        maxCommits: 100,
        maxFilesPerCommitThreshold: excludeBroadCommits ? 35 : 9999,
        forceRefresh,
        onProgress: (prog) => {
          setLoadingProgress(prog);
        },
      });
      setRawGraphData(data);
      setIsLoading(false);
    } catch (err) {
      setIsLoading(false);
      setErrorType(err.type || (err.message === 'RATE_LIMIT_EXCEEDED' ? 'RATE_LIMIT' : 'UNKNOWN'));
      setErrorMessage(err.message || 'Unable to load codebase co-change relationships.');
    }
  };

  useEffect(() => {
    loadData();
  }, [repo, excludeBroadCommits]);

  const handleSaveToken = (e) => {
    e.preventDefault();
    if (tokenInput.trim()) {
      localStorage.setItem('github_token', tokenInput.trim());
      loadData(true);
    }
  };

  // 2. Compute Filtered Graph
  const filteredGraph = useMemo(() => {
    if (!rawGraphData) return null;
    return filterCoChangeGraph(rawGraphData, {
      directory: selectedDirectory,
      selectedClusterId,
      minSharedCommits,
      searchQuery,
    });
  }, [rawGraphData, selectedDirectory, selectedClusterId, minSharedCommits, searchQuery]);

  // Unique directories for filter dropdown
  const uniqueDirectoriesList = useMemo(() => {
    if (!rawGraphData?.nodes) return [];
    const dirsSet = new Set(rawGraphData.nodes.map((n) => n.directory));
    return Array.from(dirsSet).sort();
  }, [rawGraphData?.nodes]);

  // Active selected node & edge details
  const activeNode = useMemo(() => {
    if (!rawGraphData?.nodes || !selectedNodeId) return null;
    return rawGraphData.nodes.find((n) => n.id === selectedNodeId) || null;
  }, [rawGraphData?.nodes, selectedNodeId]);

  const activeEdge = useMemo(() => {
    if (!rawGraphData?.edges || !selectedEdgeId) return null;
    return rawGraphData.edges.find((e) => e.id === selectedEdgeId) || null;
  }, [rawGraphData?.edges, selectedEdgeId]);

  // Mini-screen modal open status
  const isMiniScreenOpen = Boolean(activeNode || activeEdge || selectedClusterDetails);

  // Lock main screen scrolling when any mini screen modal is open
  useEffect(() => {
    if (isMiniScreenOpen) {
      document.body.classList.add('mini-screen-locked');
      document.documentElement.classList.add('mini-screen-locked');
      if (window.__lenis) {
        window.__lenis.stop();
      }
    } else {
      document.body.classList.remove('mini-screen-locked');
      document.documentElement.classList.remove('mini-screen-locked');
      if (window.__lenis) {
        window.__lenis.start();
      }
    }

    return () => {
      document.body.classList.remove('mini-screen-locked');
      document.documentElement.classList.remove('mini-screen-locked');
      if (window.__lenis) {
        window.__lenis.start();
      }
    };
  }, [isMiniScreenOpen]);

  // 3. Compute Radial & Force Layout Coordinates for SVG Graph
  const layoutPositions = useMemo(() => {
    const nodes = filteredGraph?.nodes || [];
    const positions = new Map();
    const count = nodes.length;
    if (count === 0) return positions;

    const width = 880;
    const height = 540;
    const centerX = width / 2;
    const centerY = height / 2;

    const ring1Count = Math.min(8, count);
    const ring2Count = Math.min(18, Math.max(0, count - ring1Count));
    const ring3Count = Math.max(0, count - ring1Count - ring2Count);

    const radius1 = 110;
    const radius2 = 210;
    const radius3 = 300;

    nodes.forEach((node, index) => {
      let r = radius1;
      let angle = 0;

      if (index < ring1Count) {
        r = radius1;
        angle = (index / ring1Count) * Math.PI * 2;
      } else if (index < ring1Count + ring2Count) {
        r = radius2;
        const ringIdx = index - ring1Count;
        angle = (ringIdx / ring2Count) * Math.PI * 2 + 0.3;
      } else {
        r = radius3;
        const ringIdx = index - ring1Count - ring2Count;
        angle = (ringIdx / Math.max(1, ring3Count)) * Math.PI * 2 + 0.6;
      }

      const x = centerX + Math.cos(angle) * r;
      const y = centerY + Math.sin(angle) * r;

      const sizeRadius = Math.min(22, Math.max(9, 7 + Math.sqrt(node.uniqueCommits) * 3));

      positions.set(node.id, { x, y, radius: sizeRadius, angle, r });
    });

    return positions;
  }, [filteredGraph?.nodes]);

  // Connected node ids for neighborhood highlighting
  const connectedNodeIdsSet = useMemo(() => {
    if (!activeFocusId || !rawGraphData?.edges) return new Set();
    const set = new Set();
    set.add(activeFocusId);
    rawGraphData.edges.forEach((edge) => {
      if (edge.source === activeFocusId) set.add(edge.target);
      if (edge.target === activeFocusId) set.add(edge.source);
    });
    return set;
  }, [activeFocusId, rawGraphData?.edges]);

  const focusedNode = useMemo(() => {
    if (!activeFocusId || !rawGraphData?.nodes) return null;
    return rawGraphData.nodes.find((n) => n.id === activeFocusId) || null;
  }, [activeFocusId, rawGraphData?.nodes]);

  // SVG Pan & Zoom Handlers
  const handleWheel = (e) => {
    e.preventDefault();
    const zoomFactor = e.deltaY < 0 ? 1.1 : 0.9;
    setZoomLevel((prev) => Math.min(3.5, Math.max(0.4, prev * zoomFactor)));
  };

  const handleMouseDown = (e) => {
    if (e.target.tagName === 'svg' || e.target.tagName === 'rect' || e.target.classList.contains('canvas-background')) {
      setIsPanning(true);
      setPanStart({ x: e.clientX - panOffset.x, y: e.clientY - panOffset.y });
    }
  };

  const handleMouseMove = (e) => {
    if (!isPanning) return;
    setPanOffset({
      x: e.clientX - panStart.x,
      y: e.clientY - panStart.y,
    });
  };

  const handleMouseUp = () => {
    setIsPanning(false);
  };

  const handleResetZoom = () => {
    setZoomLevel(1.0);
    setPanOffset({ x: 0, y: 0 });
    setSelectedNodeId(null);
    setSelectedEdgeId(null);
  };

  // Cluster color palette
  const getClusterColor = (clusterId) => {
    const palette = [
      '#3b82f6', '#10b981', '#ec4899', '#8b5cf6',
      '#f59e0b', '#06b6d4', '#6366f1', '#14b8a6',
    ];
    if (typeof clusterId === 'number') {
      return palette[clusterId % palette.length];
    }
    let hash = 0;
    const str = String(clusterId || '');
    for (let i = 0; i < str.length; i++) {
      hash = str.charCodeAt(i) + ((hash << 5) - hash);
    }
    return palette[Math.abs(hash) % palette.length];
  };

  // Loading State View
  if (isLoading) {
    return (
      <div className="apple-minimal-stage">
        {onBack && (
          <div className="apple-hub-return-strip mb-3">
            <button type="button" className="apple-hub-return-btn" onClick={onBack}>
              <i className="bi bi-arrow-left me-2"></i>
              <span>3D Hub</span>
            </button>
          </div>
        )}
        <div className="repo-timeline-clean-card text-center py-5 animate-fade-in">
          <div className="apple-spinner-clean mb-4"></div>
          <h3 className="h4 fw-bold text-dark mb-2">Analyzing Codebase Co-Change History</h3>
          <p className="text-secondary max-w-md mx-auto mb-4">
            Mining commit file changes, calculating Jaccard associations, and detecting cohesive change clusters for{' '}
            <strong className="text-dark">{fullName}</strong>...
          </p>
          <div className="stage-progress-track max-w-sm mx-auto">
            <div 
              className="stage-progress-fill bg-gradient-pink"
              style={{ width: `${loadingProgress.total > 0 ? (loadingProgress.loaded / loadingProgress.total) * 100 : 25}%` }}
            ></div>
          </div>
          <span className="small text-muted mt-2 d-block">
            {loadingProgress.phase === 'fetching_details'
              ? `Processing commit ${loadingProgress.loaded} of ${loadingProgress.total}...`
              : 'Retrieving commit file history from GitHub API...'}
          </span>
        </div>
      </div>
    );
  }

  // Error State View
  if (errorMessage && !rawGraphData) {
    return (
      <div className="apple-minimal-stage">
        {onBack && (
          <div className="apple-hub-return-strip mb-3">
            <button type="button" className="apple-hub-return-btn" onClick={onBack}>
              <i className="bi bi-arrow-left me-2"></i>
              <span>3D Hub</span>
            </button>
          </div>
        )}
        <div className="repo-timeline-clean-card text-center py-5 animate-fade-in">
          <div className="error-icon-gem text-danger mb-3">
            <i className="bi bi-exclamation-triangle-fill fs-1"></i>
          </div>
          <h3 className="h4 fw-bold text-dark mb-2">Unable to Analyze Code Relationships</h3>
          <p className="text-secondary max-w-md mx-auto mb-4">{errorMessage}</p>

          {errorType === 'RATE_LIMIT' && (
            <div className="rate-limit-token-form max-w-md mx-auto p-4 border rounded bg-light mb-4">
              <h5 className="fw-semibold fs-6 mb-2">GitHub API Rate Limit Reached</h5>
              <p className="small text-muted mb-3">
                GitHub permits 60 requests/hour unauthenticated. Enter a personal access token for 5,000 requests/hour.
              </p>
              <form onSubmit={handleSaveToken} className="d-flex gap-2">
                <input
                  type="password"
                  className="form-control form-control-sm font-monospace"
                  placeholder="ghp_..."
                  value={tokenInput}
                  onChange={(e) => setTokenInput(e.target.value)}
                />
                <button type="submit" className="apple-action-btn-clean py-1 px-3">
                  Save
                </button>
              </form>
            </div>
          )}

          <div className="d-flex justify-content-center gap-3">
            <button type="button" className="apple-action-btn-clean" onClick={() => loadData(true)}>
              <i className="bi bi-arrow-clockwise me-1"></i> Retry Analysis
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="code-explorer-viewport-stage animate-fade-in" id="explore-code-stage">
      
      {/* 1. Ultra-Compact Top Header Bar */}
      <div className="code-viewport-header d-flex align-items-center justify-content-between mb-2">
        <div className="d-flex align-items-center gap-2">
          {onBack && (
            <button 
              type="button" 
              className="btn-back-clean-sm" 
              onClick={onBack}
              title="Return to 3D Navigation Hub"
            >
              <i className="bi bi-arrow-left me-1"></i>
              <span>3D Hub</span>
            </button>
          )}

          <div className="feature-icon-badge-sm" style={{ background: 'linear-gradient(135deg, #ec4899 0%, #f43f5e 100%)' }}>
            <i className="bi bi-diagram-3-fill"></i>
          </div>

          <h2 className="code-viewport-title mb-0">Explore Code</h2>

          <a 
            href={`https://github.com/${fullName}`} 
            target="_blank" 
            rel="noreferrer"
            className="repo-pill-badge"
            title="Inspect repository on GitHub"
          >
            <i className="bi bi-github me-1"></i>
            {fullName}
          </a>

          <span className="code-live-dot" title="Grounded in real GitHub co-change history">
            <span className="pulse-pink-dot"></span> Real Co-Changes
          </span>
        </div>

        <div className="d-flex align-items-center gap-2">
          <button 
            type="button" 
            className="btn-refresh-clean-sm"
            onClick={() => loadData(true)}
            title="Refresh repository co-change data"
          >
            <i className="bi bi-arrow-clockwise me-1"></i>
            <span>Refresh</span>
          </button>
        </div>
      </div>

      {/* 2. Compact Single-Row Metric Strip */}
      <div className="code-compact-metrics-strip mb-2">
        <div className="code-metric-pill">
          <span className="metric-tag">FILES</span>
          <span className="metric-val">{rawGraphData.nodesCount}</span>
        </div>
        <div className="code-metric-pill">
          <span className="metric-tag">CO-CHANGE PAIRS</span>
          <span className="metric-val">{rawGraphData.edgesCount}</span>
        </div>
        <div className="code-metric-pill">
          <span className="metric-tag">CHANGE CLUSTERS</span>
          <span className="metric-val text-primary">{rawGraphData.clustersCount}</span>
        </div>
        <div className="code-metric-pill highlight-pink">
          <span className="metric-tag">CROSS-DIRECTORY</span>
          <span className="metric-val text-pink">{rawGraphData.crossDirectoryPct}%</span>
          <span className="metric-sub">({rawGraphData.crossDirectoryEdgesCount} links)</span>
        </div>
        <div className="code-association-note ms-auto" title={rawGraphData.coChangeAssociationDisclaimer}>
          <i className="bi bi-info-circle-fill text-pink me-1"></i>
          <span>Co-change indicates historical co-occurrence, not proven code dependencies</span>
        </div>
      </div>

      {/* 3. Combined Filter & Navigation Bar */}
      <div className="code-compact-ribbon mb-2">
        {/* Left: Tab selectors */}
        <div className="code-ribbon-tabs">
          <button 
            type="button"
            className={`code-ribbon-tab ${activeTab === 'graph' ? 'active' : ''}`}
            onClick={() => setActiveTab('graph')}
          >
            <i className="bi bi-diagram-3 me-1"></i>
            Constellation Graph
          </button>
          <button 
            type="button"
            className={`code-ribbon-tab ${activeTab === 'clusters' ? 'active' : ''}`}
            onClick={() => setActiveTab('clusters')}
          >
            <i className="bi bi-collection me-1"></i>
            Change Clusters ({filteredGraph?.clusters?.length || 0})
          </button>
          <button 
            type="button"
            className={`code-ribbon-tab ${activeTab === 'activity' ? 'active' : ''}`}
            onClick={() => setActiveTab('activity')}
          >
            <i className="bi bi-list-columns-reverse me-1"></i>
            File Leaderboard ({filteredGraph?.nodes?.length || 0})
          </button>
        </div>

        {/* Right: Inline Compact Filters */}
        <div className="code-ribbon-filters d-flex align-items-center gap-2">
          {/* File Search */}
          <div className="code-mini-search-wrap">
            <i className="bi bi-search mini-search-icon"></i>
            <input 
              type="text"
              className="code-mini-search-input"
              placeholder="Search file..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
            {searchQuery && (
              <button 
                type="button" 
                className="mini-clear-btn"
                onClick={() => setSearchQuery('')}
              >
                <i className="bi bi-x-circle-fill"></i>
              </button>
            )}
          </div>

          {/* Directory Filter */}
          <select
            className="code-mini-select"
            value={selectedDirectory}
            onChange={(e) => setSelectedDirectory(e.target.value)}
            title="Filter by directory"
          >
            <option value="all">All Dirs ({uniqueDirectoriesList.length})</option>
            {uniqueDirectoriesList.map((dir) => (
              <option key={dir} value={dir}>{dir}</option>
            ))}
          </select>

          {/* Cluster Filter */}
          <select
            className="code-mini-select"
            value={selectedClusterId}
            onChange={(e) => setSelectedClusterId(e.target.value)}
            title="Filter by change cluster"
          >
            <option value="all">All Clusters ({rawGraphData.clustersCount})</option>
            {rawGraphData.clusters.map((c) => (
              <option key={c.id} value={c.id}>{c.name} ({c.size})</option>
            ))}
          </select>

          {/* Min Shared Commits */}
          <div className="code-mini-segmented">
            <span className="mini-seg-label">Min:</span>
            {[1, 2, 3, 5].map((cnt) => (
              <button
                key={cnt}
                type="button"
                className={`mini-seg-btn ${minSharedCommits === cnt ? 'active' : ''}`}
                onClick={() => setMinSharedCommits(cnt)}
                title={`Show pairs with ${cnt}+ shared commits`}
              >
                {cnt}+
              </button>
            ))}
          </div>

          {/* Broad Commits Filter Checkbox */}
          <label className="code-mini-checkbox" title="Exclude mass commits (>35 files)">
            <input 
              type="checkbox" 
              checked={excludeBroadCommits} 
              onChange={(e) => setExcludeBroadCommits(e.target.checked)} 
            />
            <span>Filter Mass Updates (&gt;35)</span>
          </label>
        </div>
      </div>

      {/* 4. Main Viewport Container (Fills exact remaining vertical space) */}
      <div className="code-explorer-viewport-content">

        {/* TAB 1: RELATIONSHIP CONSTELLATION GRAPH */}
        {activeTab === 'graph' && (
          <div className="code-explorer-canvas-fill">
            {/* SVG Interactive Canvas */}
            <svg
              ref={svgRef}
              viewBox="0 0 880 540"
              preserveAspectRatio="xMidYMid meet"
              onWheel={handleWheel}
              onMouseDown={handleMouseDown}
              onMouseMove={handleMouseMove}
              onMouseUp={handleMouseUp}
              onMouseLeave={handleMouseUp}
              className="constellation-svg"
            >
              <rect width="880" height="540" fill="#fafbfc" className="canvas-background" />

              <g transform={`translate(${panOffset.x}, ${panOffset.y}) scale(${zoomLevel})`}>
                {/* Background Radial Guide Rings */}
                <circle cx="440" cy="270" r="110" fill="none" stroke="#f1f5f9" strokeWidth="1.5" strokeDasharray="4 4" />
                <circle cx="440" cy="270" r="210" fill="none" stroke="#f1f5f9" strokeWidth="1.5" strokeDasharray="4 4" />
                <circle cx="440" cy="270" r="300" fill="none" stroke="#f1f5f9" strokeWidth="1.5" strokeDasharray="4 4" />

                {/* 1. EDGES */}
                {filteredGraph.edges.map((edge) => {
                  const posA = layoutPositions.get(edge.source);
                  const posB = layoutPositions.get(edge.target);
                  if (!posA || !posB) return null;

                  const isSelectedEdge = selectedEdgeId === edge.id;
                  const isConnectedToFocusedNode = activeFocusId && (edge.source === activeFocusId || edge.target === activeFocusId);
                  const isDimmed = activeFocusId && !isConnectedToFocusedNode;

                  const strokeWidth = Math.min(5, Math.max(1.2, edge.sharedCommits * 0.9));
                  let strokeColor = edge.isCrossDirectory ? '#ec4899' : '#94a3b8';
                  if (isSelectedEdge) strokeColor = '#2563eb';
                  else if (isConnectedToFocusedNode) strokeColor = '#3b82f6';

                  return (
                    <line
                      key={edge.id}
                      x1={posA.x}
                      y1={posA.y}
                      x2={posB.x}
                      y2={posB.y}
                      stroke={strokeColor}
                      strokeWidth={isSelectedEdge ? strokeWidth + 2 : isConnectedToFocusedNode ? strokeWidth + 1.2 : strokeWidth}
                      strokeOpacity={isDimmed ? 0.08 : isConnectedToFocusedNode || isSelectedEdge ? 0.9 : 0.35}
                      strokeDasharray={edge.isCrossDirectory ? '5 3' : 'none'}
                      className="graph-edge-line"
                      onClick={(e) => {
                        e.stopPropagation();
                        setSelectedEdgeId(edge.id);
                      }}
                    />
                  );
                })}

                {/* 2. NODES */}
                {filteredGraph.nodes.map((node) => {
                  const pos = layoutPositions.get(node.id);
                  if (!pos) return null;

                  const isSelected = selectedNodeId === node.id;
                  const isHovered = hoveredNodeId === node.id;
                  const isNeighbor = connectedNodeIdsSet.has(node.id);
                  const isDimmed = activeFocusId && !isNeighbor;
                  const nodeColor = getClusterColor(node.cluster);

                  return (
                    <g 
                      key={node.id} 
                      transform={`translate(${pos.x}, ${pos.y})`}
                      className={`graph-node-group ${isSelected ? 'selected' : ''} ${isHovered ? 'hovered' : ''}`}
                      onMouseEnter={() => setHoveredNodeId(node.id)}
                      onMouseLeave={() => setHoveredNodeId(null)}
                      onClick={(e) => {
                        e.stopPropagation();
                        setSelectedNodeId(selectedNodeId === node.id ? null : node.id);
                        setSelectedEdgeId(null);
                      }}
                      style={{ cursor: 'pointer', opacity: isDimmed ? 0.25 : 1 }}
                    >
                      {/* Glow halo when selected or hovered */}
                      {(isSelected || isHovered) && (
                        <circle 
                          r={pos.radius + 8} 
                          fill="none" 
                          stroke={nodeColor} 
                          strokeWidth="2.5" 
                          strokeOpacity={isSelected ? 0.6 : 0.35}
                          className="animate-pulse"
                        />
                      )}

                      {/* Node Circle */}
                      <circle
                        r={pos.radius}
                        fill={nodeColor}
                        stroke="#ffffff"
                        strokeWidth="2"
                      />

                      {/* Node Label */}
                      <text
                        y={pos.radius + 13}
                        textAnchor="middle"
                        className="graph-node-label"
                        fill="#1e293b"
                        fontWeight={isSelected ? '700' : '500'}
                      >
                        {node.baseName}
                      </text>
                    </g>
                  );
                })}
              </g>
            </svg>

            {/* Floating Quick HUD Card when a node is hovered or selected */}
            {focusedNode && (
              <div className="canvas-floating-node-hud animate-fade-in">
                <div className="d-flex align-items-center justify-content-between gap-2 mb-1">
                  <div className="d-flex align-items-center gap-1 overflow-hidden">
                    <i className="bi bi-file-earmark-code text-primary"></i>
                    <span className="node-hud-name font-monospace">{focusedNode.baseName}</span>
                  </div>
                  <span className="node-hud-commits">{focusedNode.uniqueCommits} commits</span>
                </div>
                <div className="node-hud-dir text-truncate">{focusedNode.directory}</div>
                {focusedNode.topCoChanged && focusedNode.topCoChanged.length > 0 && (
                  <div className="node-hud-peers mt-2">
                    <span className="node-hud-peers-label">Frequently co-changed:</span>
                    <div className="d-flex flex-wrap gap-1 mt-1">
                      {focusedNode.topCoChanged.slice(0, 3).map((peer) => (
                        <span key={peer.filename} className="node-hud-peer-pill">
                          {peer.baseName} ({Math.round(peer.jaccard * 100)}%)
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* In-Canvas Zoom Controls (Pinned to top-right) */}
            <div className="canvas-pinned-zoom-controls">
              <button 
                type="button" 
                className="canvas-zoom-btn"
                onClick={() => setZoomLevel((z) => Math.min(3.5, z * 1.2))}
                title="Zoom In"
              >
                <i className="bi bi-plus-lg"></i>
              </button>
              <button 
                type="button" 
                className="canvas-zoom-btn"
                onClick={() => setZoomLevel((z) => Math.max(0.4, z * 0.8))}
                title="Zoom Out"
              >
                <i className="bi bi-dash-lg"></i>
              </button>
              <button 
                type="button" 
                className="canvas-zoom-btn"
                onClick={handleResetZoom}
                title="Reset View"
              >
                <i className="bi bi-arrows-fullscreen"></i>
              </button>
            </div>

            {/* Bottom In-Canvas Meta Bar */}
            <div className="canvas-pinned-bottom-bar d-flex align-items-center justify-content-between">
              <div className="d-flex align-items-center gap-2">
                <span className="small text-muted">
                  {filteredGraph.filteredNodesCount} files &bull; {filteredGraph.filteredEdgesCount} co-change links
                </span>
                <span className="badge bg-white text-dark border">
                  <span className="legend-dot me-1" style={{ background: '#ec4899' }}></span> Cross-Directory
                </span>
                <span className="badge bg-white text-dark border">
                  <span className="legend-dot me-1" style={{ background: '#94a3b8' }}></span> Same Folder
                </span>
              </div>
              <span className="small text-secondary">
                Click file node to open details &bull; Click edge to view shared commits
              </span>
            </div>
          </div>
        )}

        {/* TAB 2: CHANGE CLUSTERS */}
        {activeTab === 'clusters' && (
          <div className="code-viewport-scroll-area animate-fade-in" data-lenis-prevent="true">
            <div className="clusters-grid">
              {filteredGraph.clusters.map((cluster) => {
                const color = getClusterColor(cluster.id);

                return (
                  <div key={cluster.id} className="cluster-summary-card">
                    <div className="d-flex align-items-center justify-content-between mb-2">
                      <span className="cluster-color-pill" style={{ background: color }}>
                        {cluster.name}
                      </span>
                      {cluster.isCrossModule && (
                        <span className="badge bg-pink text-white" style={{ background: '#ec4899', fontSize: '10.5px' }}>
                          Cross-Module
                        </span>
                      )}
                    </div>

                    <div className="d-flex align-items-center gap-3 my-2">
                      <div>
                        <div className="fw-bold fs-5 text-dark">{cluster.size}</div>
                        <div className="small text-muted">files</div>
                      </div>
                      <div>
                        <div className="fw-bold fs-5 text-dark">{cluster.directories.length}</div>
                        <div className="small text-muted">directories</div>
                      </div>
                      <div>
                        <div className="fw-bold fs-5 text-dark">{cluster.totalCommitsCount}</div>
                        <div className="small text-muted">commits</div>
                      </div>
                    </div>

                    {/* Files inside cluster */}
                    <div className="cluster-files-pill-box mt-3 mb-3">
                      <span className="small fw-semibold text-secondary d-block mb-1">Constituent Files:</span>
                      <div className="d-flex flex-wrap gap-1">
                        {cluster.files.slice(0, 6).map((f) => (
                          <span key={f} className="badge bg-light text-dark border">
                            {f.split('/').pop()}
                          </span>
                        ))}
                        {cluster.files.length > 6 && (
                          <span className="badge bg-secondary text-white">+{cluster.files.length - 6} more</span>
                        )}
                      </div>
                    </div>

                    <div className="d-flex align-items-center justify-content-between pt-2 border-top">
                      <span className="small text-muted">{cluster.contributorsCount} contributors</span>
                      <button
                        type="button"
                        className="apple-action-btn-clean py-1 px-3"
                        onClick={() => setSelectedClusterDetails(cluster)}
                      >
                        Inspect Cluster
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* TAB 3: FILE ACTIVITY LEADERBOARD */}
        {activeTab === 'activity' && (
          <div className="code-viewport-scroll-area animate-fade-in" data-lenis-prevent="true">
            <div className="matrix-table-card table-responsive">
              <table className="table matrix-clean-table align-middle">
                <thead>
                  <tr>
                    <th>File Path</th>
                    <th>Directory</th>
                    <th className="text-center">Unique Commits</th>
                    <th className="text-center">Authors</th>
                    <th>Frequently Changed Together</th>
                    <th className="text-end">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredGraph.nodes.map((node) => (
                    <tr key={node.id}>
                      <td>
                        <span className="fw-bold text-dark font-monospace small">{node.baseName}</span>
                        <span className="text-muted small d-block">{node.filename}</span>
                      </td>
                      <td>
                        <span className="badge bg-light text-secondary border font-monospace">
                          {node.directory}
                        </span>
                      </td>
                      <td className="text-center">
                        <span className="badge bg-primary text-white px-2 py-1">
                          {node.uniqueCommits}
                        </span>
                      </td>
                      <td className="text-center">
                        <span className="small text-dark fw-semibold">{node.contributorsCount}</span>
                      </td>
                      <td>
                        <div className="d-flex flex-wrap gap-1">
                          {node.topCoChanged.slice(0, 3).map((co) => (
                            <span key={co.filename} className="badge bg-light text-dark border small" title={`${co.sharedCommits} shared commits`}>
                              {co.baseName} ({co.sharedCommits})
                            </span>
                          ))}
                        </div>
                      </td>
                      <td className="text-end">
                        <button
                          type="button"
                          className="apple-action-btn-clean py-1 px-2"
                          onClick={() => {
                            setSelectedNodeId(node.id);
                            setActiveTab('graph');
                          }}
                        >
                          View Details
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

      </div>

      {/* ==============================================================
          1. FILE RELATIONSHIP MINI SCREEN (SCROLLABLE, BACKGROUND LOCKED)
          ============================================================== */}
      {activeNode && (
        <div 
          className="pipe-feature-modal-backdrop" 
          onClick={() => setSelectedNodeId(null)}
          onWheel={(e) => e.stopPropagation()}
          data-lenis-prevent="true"
        >
          <div 
            className="pipe-feature-modal-window" 
            data-lenis-prevent="true"
            onWheel={(e) => e.stopPropagation()}
            onClick={(e) => e.stopPropagation()} 
            style={{ maxWidth: '680px' }}
          >
            <div className="pipe-modal-header">
              <div className="d-flex align-items-center gap-2">
                <i className="bi bi-file-earmark-code text-primary fs-4"></i>
                <div>
                  <div className="fw-bold fs-6 text-dark">{activeNode.filename}</div>
                  <span className="small text-muted">Directory: {activeNode.directory}</span>
                </div>
                {activeNode.cluster && (
                  <span className="badge bg-light text-primary border ms-2">
                    {rawGraphData.clusters.find((c) => c.id === activeNode.cluster)?.name || activeNode.cluster}
                  </span>
                )}
              </div>
              <button 
                type="button" 
                className="pipe-modal-close-btn"
                onClick={() => setSelectedNodeId(null)}
                title="Close View"
              >
                <i className="bi bi-x-lg"></i>
              </button>
            </div>

            <div className="pipe-modal-body p-4" data-lenis-prevent="true">
              {/* Metric stats row */}
              <div className="d-flex justify-content-around py-2 border-bottom mb-3">
                <div className="text-center">
                  <span className="small text-muted d-block">Unique Commits</span>
                  <span className="fw-bold text-dark fs-5">{activeNode.uniqueCommits}</span>
                </div>
                <div className="text-center">
                  <span className="small text-muted d-block">Contributors</span>
                  <span className="fw-bold text-dark fs-5">{activeNode.contributorsCount}</span>
                </div>
                <div className="text-center">
                  <span className="small text-muted d-block">Co-Changed Files</span>
                  <span className="fw-bold text-dark fs-5">{activeNode.topCoChanged.length}</span>
                </div>
              </div>

              {/* Frequently Changed Together */}
              <h5 className="section-sub-title mb-2">
                <i className="bi bi-link-45deg me-1"></i>
                Frequently Changed Together ({activeNode.topCoChanged.length})
              </h5>
              <div className="co-changed-pills-row d-flex flex-wrap gap-2 mb-4">
                {activeNode.topCoChanged.length === 0 ? (
                  <span className="text-muted small">No other files changed in the same commits.</span>
                ) : (
                  activeNode.topCoChanged.map((rel) => (
                    <button
                      key={rel.filename}
                      type="button"
                      className="co-change-assoc-btn"
                      onClick={() => {
                        const edgeKey1 = `${activeNode.id}::${rel.filename}`;
                        const edgeKey2 = `${rel.filename}::${activeNode.id}`;
                        const edge = rawGraphData.edges.find((e) => e.id === edgeKey1 || e.id === edgeKey2);
                        if (edge) setSelectedEdgeId(edge.id);
                      }}
                      title={`Click to view ${rel.sharedCommits} supporting commits`}
                    >
                      <span className="assoc-filename">{rel.baseName}</span>
                      <span className="assoc-count-tag">{rel.sharedCommits} shared</span>
                      <span className="assoc-jaccard-tag">{(rel.jaccard * 100).toFixed(0)}%</span>
                    </button>
                  ))
                )}
              </div>

              {/* Recent Commits Modifying This File */}
              <h5 className="section-sub-title mb-2">
                <i className="bi bi-clock-history me-1"></i>
                Recent Commits Modifying {activeNode.baseName} ({activeNode.commits.length})
              </h5>
              <div className="commits-inspect-list" data-lenis-prevent="true" style={{ maxHeight: '250px', overflowY: 'auto' }}>
                {activeNode.commits.map((c) => (
                  <div key={c.sha} className="p-2 border-bottom d-flex align-items-center justify-content-between">
                    <div>
                      <code className="commit-sha-pill me-2">{c.shortSha}</code>
                      <span className="small text-dark fw-semibold">{c.message}</span>
                    </div>
                    <div className="d-flex align-items-center gap-2">
                      <span className="small text-muted">{new Date(c.date).toLocaleDateString()}</span>
                      <a href={c.htmlUrl} target="_blank" rel="noreferrer" className="commit-gh-icon-link">
                        <i className="bi bi-box-arrow-up-right"></i>
                      </a>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ==============================================================
          2. RELATIONSHIP INSPECTOR MINI SCREEN (SCROLLABLE, BACKGROUND LOCKED)
          ============================================================== */}
      {activeEdge && (
        <div 
          className="pipe-feature-modal-backdrop" 
          onClick={() => setSelectedEdgeId(null)}
          onWheel={(e) => e.stopPropagation()}
          data-lenis-prevent="true"
        >
          <div 
            className="pipe-feature-modal-window" 
            data-lenis-prevent="true"
            onWheel={(e) => e.stopPropagation()}
            onClick={(e) => e.stopPropagation()} 
            style={{ maxWidth: '640px' }}
          >
            <div className="pipe-modal-header">
              <div className="d-flex align-items-center gap-2">
                <i className="bi bi-link-45deg text-primary fs-4"></i>
                <span className="modal-feature-title">Co-Change Association Details</span>
              </div>
              <button 
                type="button" 
                className="pipe-modal-close-btn"
                onClick={() => setSelectedEdgeId(null)}
              >
                <i className="bi bi-x-lg"></i>
              </button>
            </div>

            <div className="pipe-modal-body p-4" data-lenis-prevent="true">
              <div className="d-flex align-items-center justify-content-between p-3 bg-light rounded mb-3">
                <div className="overflow-hidden">
                  <div className="fw-bold font-monospace small">{activeEdge.source.split('/').pop()}</div>
                  <div className="text-muted small text-truncate" style={{ maxWidth: '240px' }}>{activeEdge.source}</div>
                </div>
                <div className="text-center px-3">
                  <i className="bi bi-arrow-left-right text-primary fs-5"></i>
                  <div className="fw-bold text-primary">{activeEdge.sharedCommits} shared commits</div>
                </div>
                <div className="text-end overflow-hidden">
                  <div className="fw-bold font-monospace small">{activeEdge.target.split('/').pop()}</div>
                  <div className="text-muted small text-truncate" style={{ maxWidth: '240px' }}>{activeEdge.target}</div>
                </div>
              </div>

              {/* Visual Coupling Strength Meter */}
              <div className="coupling-visual-meter my-3 p-3 bg-light rounded">
                <div className="d-flex align-items-center justify-content-between mb-2">
                  <span className="small fw-semibold text-secondary">
                    <i className="bi bi-bezier2 me-1"></i>
                    Coupling Strength
                  </span>
                  <span className={`coupling-strength-pill ${activeEdge.jaccard >= 0.6 ? 'critical' : activeEdge.jaccard >= 0.3 ? 'strong' : 'moderate'}`}>
                    {(activeEdge.jaccard * 100).toFixed(0)}% • {activeEdge.jaccard >= 0.6 ? 'High Co-Change' : activeEdge.jaccard >= 0.3 ? 'Moderate Co-Change' : 'Light Co-Change'}
                  </span>
                </div>
                <div className="coupling-meter-track">
                  <div 
                    className="coupling-meter-fill" 
                    style={{ width: `${Math.min(100, Math.round(activeEdge.jaccard * 100))}%` }} 
                  />
                </div>
              </div>

              <div className="d-flex justify-content-around py-2 border-bottom mb-3">
                <div className="text-center">
                  <span className="small text-muted d-block">Jaccard Score</span>
                  <span className="fw-bold text-dark fs-5">{(activeEdge.jaccard * 100).toFixed(1)}%</span>
                </div>
                <div className="text-center">
                  <span className="small text-muted d-block">Scope</span>
                  <span className={`badge ${activeEdge.isCrossDirectory ? 'bg-pink text-white' : 'bg-light text-dark border'}`} style={activeEdge.isCrossDirectory ? { background: '#ec4899' } : {}}>
                    {activeEdge.isCrossDirectory ? 'Cross-Directory' : 'Same Directory'}
                  </span>
                </div>
              </div>

              {/* Supporting Commits */}
              <h5 className="section-sub-title mb-2">Supporting Commits ({activeEdge.commits.length})</h5>
              <div className="commits-inspect-list" data-lenis-prevent="true" style={{ maxHeight: '280px', overflowY: 'auto' }}>
                {activeEdge.commits.map((c) => (
                  <div key={c.sha} className="p-2 border-bottom d-flex align-items-center justify-content-between">
                    <div>
                      <code className="commit-sha-pill me-2">{c.shortSha}</code>
                      <span className="small text-dark fw-semibold">{c.message}</span>
                    </div>
                    <div className="d-flex align-items-center gap-2">
                      <span className="small text-muted">{new Date(c.date).toLocaleDateString()}</span>
                      <a href={c.htmlUrl} target="_blank" rel="noreferrer" className="commit-gh-icon-link">
                        <i className="bi bi-box-arrow-up-right"></i>
                      </a>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ==============================================================
          3. CLUSTER INSPECTOR MINI SCREEN (SCROLLABLE, BACKGROUND LOCKED)
          ============================================================== */}
      {selectedClusterDetails && (
        <div 
          className="pipe-feature-modal-backdrop" 
          onClick={() => setSelectedClusterDetails(null)}
          onWheel={(e) => e.stopPropagation()}
          data-lenis-prevent="true"
        >
          <div 
            className="pipe-feature-modal-window" 
            data-lenis-prevent="true"
            onWheel={(e) => e.stopPropagation()}
            onClick={(e) => e.stopPropagation()} 
            style={{ maxWidth: '720px' }}
          >
            <div className="pipe-modal-header">
              <div className="d-flex align-items-center gap-2">
                <span className="modal-feature-title">{selectedClusterDetails.name}</span>
                <span className="badge bg-primary text-white">{selectedClusterDetails.size} files</span>
              </div>
              <button 
                type="button" 
                className="pipe-modal-close-btn"
                onClick={() => setSelectedClusterDetails(null)}
              >
                <i className="bi bi-x-lg"></i>
              </button>
            </div>

            <div className="pipe-modal-body p-4" data-lenis-prevent="true">
              <div className="mb-3">
                <span className="small fw-bold text-secondary">Directories Involved:</span>
                <div className="d-flex flex-wrap gap-1 mt-1">
                  {selectedClusterDetails.directories.map((d) => (
                    <span key={d} className="badge bg-light text-dark border font-monospace">
                      {d}
                    </span>
                  ))}
                </div>
              </div>

              <div className="mb-4">
                <span className="small fw-bold text-secondary">Files in Cluster:</span>
                <div className="d-flex flex-wrap gap-2 mt-1">
                  {selectedClusterDetails.files.map((f) => (
                    <button 
                      key={f} 
                      type="button"
                      className="btn btn-sm btn-outline-primary"
                      onClick={() => {
                        setSelectedNodeId(f);
                        setSelectedClusterDetails(null);
                        setActiveTab('graph');
                      }}
                    >
                      {f.split('/').pop()}
                    </button>
                  ))}
                </div>
              </div>

              <h5 className="section-sub-title mb-2">Supporting Commits ({selectedClusterDetails.supportingCommits.length})</h5>
              <div className="commits-inspect-list" data-lenis-prevent="true" style={{ maxHeight: '240px', overflowY: 'auto' }}>
                {selectedClusterDetails.supportingCommits.map((c) => (
                  <div key={c.sha} className="p-2 border-bottom d-flex align-items-center justify-content-between">
                    <div>
                      <code className="commit-sha-pill me-2">{c.shortSha}</code>
                      <span className="small text-dark fw-semibold">{c.message}</span>
                    </div>
                    <div className="d-flex align-items-center gap-2">
                      <span className="small text-muted">{new Date(c.date).toLocaleDateString()}</span>
                      <a href={c.htmlUrl} target="_blank" rel="noreferrer" className="commit-gh-icon-link">
                        <i className="bi bi-box-arrow-up-right"></i>
                      </a>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
