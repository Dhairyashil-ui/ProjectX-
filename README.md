# GitStory AI — Visual GitHub Repository Explorer & Intelligence Engine

> Transform any public GitHub repository into an interactive visual overview of its architecture, activity, team dynamics, and semantic code intelligence.

---

## 🔗 Quick Links

- 🚀 **Live Application**: [https://project-x-ten-tau.vercel.app/](https://project-x-ten-tau.vercel.app/)
- 🎥 **Video Demo**: [https://youtu.be/9u1Jv9XHZpM](https://youtu.be/9u1Jv9XHZpM)
- 💻 **GitHub Repository**: [https://github.com/Dhairyashil-ui/ProjectX-](https://github.com/Dhairyashil-ui/ProjectX-)

---

## ✨ Key Capabilities

1. **GitStory AI (Ask the Repository)**
   - Semantic natural language Q&A grounded in live GitHub AST and actual source code.
   - High-speed Groq LPU engine (`qwen/qwen3.8-27b`) with streaming SSE responses.
   - Verifiable code citations linking directly to exact GitHub file line numbers.
   - 1-click Architecture & Component Summaries.

2. **Explore Code (Coupling & Co-Change Constellation)**
   - Interactive 2D/3D force-directed constellation map of tightly coupled files.
   - Jaccard co-change similarity detection to uncover hidden architectural dependencies.
   - Segmented coupling strength meter and multi-module PR investigation.

3. **Explore Collaborators (Developer DNA & Bus Factor)**
   - Interactive 3-tier Bus Factor gauge (`Distributed`, `Moderate`, `Silo`) measuring knowledge concentration.
   - Contributor leaderboard with verified commit shares and directory impact tracks.
   - Subsystem ownership heatmaps.

4. **Explore Timeline (Chronological Release Journey)**
   - Momentum-scrolled historical commit timeline with collision-free milestone detection.
   - Dynamic 3D activity histograms highlighting peak release periods.
   - Deep inspection of changed files, line additions/deletions, and historical trees.

---

## 🛠️ Tech Stack

- **Frontend**: React 18, Vite, Three.js, Lucide Icons, Bootstrap Icons, Lenis Smooth Scroll
- **Backend / Serverless**: Node.js, Vercel Serverless Functions (`/api/index.js`), Groq Cloud API, GitHub REST API v3
- **Deployment**: Vercel
