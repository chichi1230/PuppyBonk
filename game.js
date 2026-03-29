(() => {
  const MIN_GROUP = 2;
  const LEVEL_COUNT = 100;

  const PIECE_CLASS_COUNT = 6;
  /**
   * 与 index.html 同目录：默认 dogpicture/0.jpg … dogpicture/5.jpg
   * 更换文件夹内照片后请把 PIECE_IMAGE_VERSION 改成新值（或递增），否则浏览器可能一直用旧图缓存。
   */
  const PIECE_IMAGE_DIR = "dogpicture";
  const PIECE_IMAGE_EXT = "jpg";
  /** 仅影响 URL 查询参数，不改磁盘文件名 */
  const PIECE_IMAGE_VERSION = "2";
  /** 若图片命名为 dog0.jpg，设为 "dog"；默认无前缀 */
  const PIECE_IMAGE_PREFIX = "";
  /** 磁盘文件名数字：0 表示 0.jpg；若你的文件是 1.jpg～6.jpg 则改为 1 */
  const PIECE_IMAGE_ID_OFFSET = 0;

  function pieceImageUrl(pieceId, ext) {
    const base = `${PIECE_IMAGE_PREFIX}${pieceId + PIECE_IMAGE_ID_OFFSET}.${ext}`;
    const path = `${PIECE_IMAGE_DIR}/${base}`;
    try {
      const u = new URL(path, document.baseURI || window.location.href);
      u.searchParams.set("v", PIECE_IMAGE_VERSION);
      return u.href;
    } catch {
      return `${path}?v=${encodeURIComponent(PIECE_IMAGE_VERSION)}`;
    }
  }

  const PIECE_IMG_EXT_TRY = [PIECE_IMAGE_EXT, "JPG", "jpeg", "JPEG", "png", "PNG", "webp", "WEBP"];

  function bindPieceImageWithFallbacks(img, pieceId) {
    let attempt = 0;
    img.onerror = () => {
      attempt += 1;
      if (attempt >= PIECE_IMG_EXT_TRY.length) {
        img.onerror = null;
        return;
      }
      img.src = pieceImageUrl(pieceId, PIECE_IMG_EXT_TRY[attempt]);
    };
    img.src = pieceImageUrl(pieceId, PIECE_IMG_EXT_TRY[0]);
  }

  /**
   * 单关对「累计目标分」的贡献：第 1 关 500、第 2 关 578…（每关严格高于上一关的增量）。
   */
  function perLevelTarget(level) {
    const L = Math.min(LEVEL_COUNT, Math.max(1, level));
    const k = L - 1;
    return 500 + k * 78 + Math.floor((k * k) / 10);
  }

  /** 通关所需累计目标分：第 n 关死局时 得分 ≥ Σ(第1..n关单关增量)，例如第2关需 ≥ 500+578=1078 */
  function cumulativeTarget(level) {
    const L = Math.min(LEVEL_COUNT, Math.max(1, level));
    let sum = 0;
    for (let i = 1; i <= L; i++) sum += perLevelTarget(i);
    return sum;
  }

  function levelConfig(index) {
    const level = Math.min(LEVEL_COUNT, Math.max(1, index));
    const rows = 8;
    const cols = 8;
    const colorCount = Math.min(6, 4 + Math.floor((level - 1) / 26));
    const target = cumulativeTarget(level);
    return { level, rows, cols, colorCount, target };
  }

  let state = {
    cfg: levelConfig(1),
    grid: [],
    totalScore: 0,
    roundScore: 0,
    busy: false,
    preview: null,
  };

  const boardEl = document.getElementById("board");
  const totalScoreEl = document.getElementById("totalScore");
  const targetEl = document.getElementById("targetScore");
  const levelEl = document.getElementById("levelNum");
  const toastEl = document.getElementById("toast");
  const overlayEl = document.getElementById("overlay");
  const modalTitleEl = document.getElementById("modalTitle");
  const modalBodyEl = document.getElementById("modalBody");
  const btnModalPrimary = document.getElementById("btnModalPrimary");
  const btnModalSecondary = document.getElementById("btnModalSecondary");
  const levelSplashEl = document.getElementById("levelSplash");
  const levelSplashNumEl = document.getElementById("levelSplashNum");
  const levelSplashTargetEl = document.getElementById("levelSplashTarget");
  const levelSplashNextWrapEl = document.getElementById("levelSplashNextWrap");
  const levelSplashNextTargetEl = document.getElementById("levelSplashNextTarget");

  let toastTimer = null;
  let levelSplashTimer = null;
  let levelSplashOnDone = null;
  let boardAspectResizeTimer = null;

  function clearToastTimers() {
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = null;
  }

  function showToast(msg) {
    clearToastTimers();
    toastEl.textContent = msg;
    toastEl.hidden = false;
    toastTimer = setTimeout(() => {
      toastEl.hidden = true;
      toastTimer = null;
    }, 1100);
  }

  /**
   * 行数=列数时由 CSS .board 的 aspect-ratio:1 + width:min(...) 保证正方形；
   * 仅非方阵时用内联比例（计入 gap）。
   */
  function updateBoardAspectRatio() {
    if (!boardEl || !state.cfg) return;
    const { rows, cols } = state.cfg;
    if (rows === cols) {
      boardEl.style.aspectRatio = "";
      return;
    }
    const style = getComputedStyle(boardEl);
    let g = parseFloat(style.columnGap);
    if (Number.isNaN(g)) g = parseFloat(style.rowGap);
    if (Number.isNaN(g)) g = parseFloat(style.gap);
    if (Number.isNaN(g) || g < 0) g = 6;
    const u = 100;
    boardEl.style.aspectRatio = `${u * cols + g * (cols - 1)} / ${u * rows + g * (rows - 1)}`;
  }

  function dismissLevelSplash() {
    if (levelSplashOnDone == null) return;
    const done = levelSplashOnDone;
    levelSplashOnDone = null;
    if (levelSplashTimer) {
      clearTimeout(levelSplashTimer);
      levelSplashTimer = null;
    }
    levelSplashEl.classList.remove("is-visible");
    levelSplashEl.onclick = null;
    setTimeout(() => {
      levelSplashEl.hidden = true;
      done();
    }, 320);
  }

  /** 进入新关时的全屏提示：当前关目标、下一关目标（若有）。 */
  function showLevelUpSplash(onDismissed) {
    levelSplashNumEl.textContent = String(state.cfg.level);
    levelSplashTargetEl.textContent = String(state.cfg.target);
    if (state.cfg.level < LEVEL_COUNT) {
      levelSplashNextWrapEl.hidden = false;
      levelSplashNextTargetEl.textContent = String(cumulativeTarget(state.cfg.level + 1));
    } else {
      levelSplashNextWrapEl.hidden = true;
    }
    levelSplashOnDone = onDismissed;
    levelSplashEl.hidden = false;
    levelSplashTimer = setTimeout(() => dismissLevelSplash(), 2800);
    requestAnimationFrame(() => {
      levelSplashEl.classList.add("is-visible");
    });
    levelSplashEl.onclick = () => dismissLevelSplash();
  }

  function showModal({ title, body, primaryText, onPrimary, secondaryText, onSecondary, celebrate = false }) {
    const modalRoot = overlayEl.querySelector(".modal");
    if (modalRoot) {
      modalRoot.classList.remove("modal--celebrate", "modal--no-body");
    }

    modalTitleEl.textContent = title;
    const bodyStr = body == null ? "" : String(body).trim();
    modalBodyEl.textContent = bodyStr;
    modalBodyEl.hidden = !bodyStr;
    modalBodyEl.setAttribute("aria-hidden", bodyStr ? "false" : "true");
    if (!bodyStr && modalRoot) modalRoot.classList.add("modal--no-body");
    if (celebrate && modalRoot) modalRoot.classList.add("modal--celebrate");

    btnModalPrimary.textContent = primaryText;
    btnModalPrimary.onclick = () => {
      hideModal();
      onPrimary?.();
    };
    if (secondaryText) {
      btnModalSecondary.hidden = false;
      btnModalSecondary.textContent = secondaryText;
      btnModalSecondary.onclick = () => {
        hideModal();
        onSecondary?.();
      };
    } else {
      btnModalSecondary.hidden = true;
      btnModalSecondary.onclick = null;
    }
    overlayEl.classList.add("is-open");
    overlayEl.setAttribute("aria-hidden", "false");
  }

  function hideModal() {
    overlayEl.classList.remove("is-open");
    overlayEl.setAttribute("aria-hidden", "true");
    overlayEl.querySelector(".modal")?.classList.remove("modal--celebrate", "modal--no-body");
  }

  function randomColorId(n) {
    return Math.floor(Math.random() * n);
  }

  function makeGrid(rows, cols, colorCount) {
    return Array.from({ length: rows }, () =>
      Array.from({ length: cols }, () => randomColorId(colorCount)),
    );
  }

  /** 先随机；若无解，只改少量格子或强制一对相邻同色，避免大量重试卡死主线程 */
  function buildPlayableGrid(cfg) {
    const { rows, cols, colorCount: cc } = cfg;
    const n = Math.max(2, cc);
    const g = makeGrid(rows, cols, n);
    if (hasLegalMove(g)) return g;

    for (let t = 0; t < 8; t++) {
      const r = Math.floor(Math.random() * rows);
      const c = Math.floor(Math.random() * cols);
      g[r][c] = randomColorId(n);
      if (hasLegalMove(g)) return g;
    }

    const id = randomColorId(n);
    if (cols >= 2) {
      const rr = Math.floor(Math.random() * rows);
      const cc0 = Math.floor(Math.random() * (cols - 1));
      g[rr][cc0] = id;
      g[rr][cc0 + 1] = id;
    } else if (rows >= 2) {
      const cc0 = Math.floor(Math.random() * cols);
      const rr = Math.floor(Math.random() * (rows - 1));
      g[rr][cc0] = id;
      g[rr + 1][cc0] = id;
    }
    return g;
  }

  /** 复用缓冲区，避免每次 findCluster / hasLegalMove 分配大量二维数组触发 GC 风暴（弱机 + 频繁预览时易卡死） */
  let visitBuf = new Uint8Array(128);
  let visitStack = [];

  function ensureVisitSize(n) {
    if (visitBuf.length < n) visitBuf = new Uint8Array(Math.ceil(n * 1.5));
  }

  function findCluster(grid, sr, sc) {
    const rows = grid.length;
    const cols = grid[0].length;
    const id = grid[sr][sc];
    if (id === -1) return [];
    const n = rows * cols;
    ensureVisitSize(n);
    visitBuf.fill(0);
    const stack = visitStack;
    stack.length = 0;
    const cells = [];
    const push = (r, c) => {
      const i = r * cols + c;
      if (visitBuf[i]) return;
      visitBuf[i] = 1;
      stack.push(r, c);
    };
    push(sr, sc);
    while (stack.length) {
      const c = stack.pop();
      const r = stack.pop();
      cells.push([r, c]);
      if (r > 0) {
        const nr = r - 1;
        const nc = c;
        const i = nr * cols + nc;
        if (!visitBuf[i] && grid[nr][nc] === id) push(nr, nc);
      }
      if (r < rows - 1) {
        const nr = r + 1;
        const nc = c;
        const i = nr * cols + nc;
        if (!visitBuf[i] && grid[nr][nc] === id) push(nr, nc);
      }
      if (c > 0) {
        const nr = r;
        const nc = c - 1;
        const i = nr * cols + nc;
        if (!visitBuf[i] && grid[nr][nc] === id) push(nr, nc);
      }
      if (c < cols - 1) {
        const nr = r;
        const nc = c + 1;
        const i = nr * cols + nc;
        if (!visitBuf[i] && grid[nr][nc] === id) push(nr, nc);
      }
    }
    return cells;
  }

  function clusterPoints(n) {
    return Math.floor(n * n * 5.6 + n * 2);
  }

  function hasLegalMove(grid) {
    if (!grid.length || !grid[0].length) return false;
    const rows = grid.length;
    const cols = grid[0].length;
    const n = rows * cols;
    ensureVisitSize(n);
    visitBuf.fill(0);
    const stack = visitStack;
    const push = (rr, cc) => {
      const i = rr * cols + cc;
      if (visitBuf[i]) return;
      visitBuf[i] = 1;
      stack.push(rr, cc);
    };
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const start = r * cols + c;
        if (grid[r][c] === -1 || visitBuf[start]) continue;
        const id = grid[r][c];
        stack.length = 0;
        push(r, c);
        let count = 0;
        while (stack.length) {
          const cc = stack.pop();
          const cr = stack.pop();
          count++;
          if (cr > 0) {
            const nr = cr - 1;
            const nc = cc;
            const i = nr * cols + nc;
            if (!visitBuf[i] && grid[nr][nc] === id) push(nr, nc);
          }
          if (cr < rows - 1) {
            const nr = cr + 1;
            const nc = cc;
            const i = nr * cols + nc;
            if (!visitBuf[i] && grid[nr][nc] === id) push(nr, nc);
          }
          if (cc > 0) {
            const nr = cr;
            const nc = cc - 1;
            const i = nr * cols + nc;
            if (!visitBuf[i] && grid[nr][nc] === id) push(nr, nc);
          }
          if (cc < cols - 1) {
            const nr = cr;
            const nc = cc + 1;
            const i = nr * cols + nc;
            if (!visitBuf[i] && grid[nr][nc] === id) push(nr, nc);
          }
        }
        if (count >= MIN_GROUP) return true;
      }
    }
    return false;
  }

  function applyGravity(grid) {
    const rows = grid.length;
    const cols = grid[0].length;
    for (let c = 0; c < cols; c++) {
      let write = rows - 1;
      for (let r = rows - 1; r >= 0; r--) {
        if (grid[r][c] !== -1) {
          grid[write][c] = grid[r][c];
          write--;
        }
      }
      while (write >= 0) {
        grid[write][c] = -1;
        write--;
      }
    }
  }

  function collapseColumns(grid) {
    const rows = grid.length;
    const cols = grid[0].length;
    let anyTile = false;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        if (grid[r][c] !== -1) {
          anyTile = true;
          break;
        }
      }
      if (anyTile) break;
    }
    // 全盘已空时：左移列不会改变盘面，原逻辑会在 col=0 死循环卡死主线程
    if (!anyTile) return;

    let col = 0;
    let guard = 0;
    const maxIter = cols * cols + 8;
    while (col < cols && guard++ < maxIter) {
      let empty = true;
      for (let r = 0; r < rows; r++) {
        if (grid[r][col] !== -1) {
          empty = false;
          break;
        }
      }
      if (empty) {
        for (let c = col; c < cols - 1; c++) {
          for (let r = 0; r < rows; r++) grid[r][c] = grid[r][c + 1];
        }
        for (let r = 0; r < rows; r++) grid[r][cols - 1] = -1;
      } else {
        col++;
      }
    }
  }

  function renderBoard() {
    const { rows, cols } = state.cfg;
    const grid = state.grid;
    boardEl.style.setProperty("--board-rows", String(rows));
    boardEl.style.setProperty("--board-cols", String(cols));
    boardEl.style.gridTemplateRows = `repeat(${rows}, 1fr)`;
    boardEl.style.gridTemplateColumns = `repeat(${cols}, 1fr)`;
    boardEl.innerHTML = "";
    const frag = document.createDocumentFragment();

    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const id = grid[r][c];
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "cell";
        btn.dataset.row = String(r);
        btn.dataset.col = String(c);
        btn.setAttribute("aria-label", `格子 ${r + 1}-${c + 1}`);
        if (id === -1) {
          btn.classList.add("empty");
          btn.disabled = true;
        } else {
          const pieceId = id % PIECE_CLASS_COUNT;
          btn.classList.add(`cell--piece-${pieceId}`);
          const cap = document.createElement("span");
          cap.className = "cell-cap";
          cap.setAttribute("aria-hidden", "true");
          const img = document.createElement("img");
          img.className = "cell-img";
          img.alt = "";
          img.decoding = "async";
          img.draggable = false;
          bindPieceImageWithFallbacks(img, pieceId);
          cap.appendChild(img);
          btn.appendChild(cap);
        }
        frag.appendChild(btn);
      }
    }
    boardEl.appendChild(frag);
    attachCellHandlers();
    updatePreviewHighlight();
    requestAnimationFrame(() => {
      updateBoardAspectRatio();
      requestAnimationFrame(updateBoardAspectRatio);
    });
  }

  function updatePreviewHighlight() {
    boardEl.querySelectorAll(".cell.preview").forEach((el) => el.classList.remove("preview"));
    if (!state.preview) return;
    const set = new Set(state.preview.map(([r, c]) => `${r},${c}`));
    boardEl.querySelectorAll(".cell:not(.empty)").forEach((el) => {
      const r = Number(el.dataset.row);
      const c = Number(el.dataset.col);
      if (set.has(`${r},${c}`)) el.classList.add("preview");
    });
  }

  let previewRaf = 0;
  let previewPending = null;

  function flushPreview() {
    previewRaf = 0;
    if (previewPending === null) return;
    const { row, col } = previewPending;
    previewPending = null;
    if (state.busy) return;
    const id = state.grid[row]?.[col];
    if (id === undefined || id === -1) {
      state.preview = null;
      updatePreviewHighlight();
      return;
    }
    const cluster = findCluster(state.grid, row, col);
    state.preview = cluster.length >= MIN_GROUP ? cluster : null;
    updatePreviewHighlight();
  }

  function setPreviewFromPoint(row, col) {
    if (state.busy) return;
    previewPending = { row, col };
    if (!previewRaf) {
      previewRaf = requestAnimationFrame(flushPreview);
    }
  }

  function clearPreview() {
    previewPending = null;
    if (previewRaf) {
      cancelAnimationFrame(previewRaf);
      previewRaf = 0;
    }
    state.preview = null;
    updatePreviewHighlight();
  }

  function tryEliminate(row, col) {
    if (state.busy) return;
    const cluster = findCluster(state.grid, row, col);
    if (cluster.length < MIN_GROUP) {
      showToast("需要至少两个相连的同类图形");
      return;
    }
    state.busy = true;
    clearPreview();
    window.gameAudio?.playEliminate?.(cluster.length);
    try {
      const pts = clusterPoints(cluster.length);
      state.totalScore += pts;
      state.roundScore += pts;
      totalScoreEl.textContent = String(state.totalScore);

      for (const [r, c] of cluster) state.grid[r][c] = -1;
      applyGravity(state.grid);
      collapseColumns(state.grid);
      renderBoard();
    } catch (err) {
      console.error(err);
      state.busy = false;
      showToast("出错，请重试");
      return;
    }

    requestAnimationFrame(() => {
      try {
        finishTurn();
      } catch (e2) {
        console.error(e2);
        state.busy = false;
      }
    });
  }

  /**
   * 盘面无可消时本关结束：过关条件为「得分 ≥ 截至本关的目标」；须玩到无可消为止。
   * 失败则整局清零，从第 1 关重新开始。
   */
  function endCurrentRound() {
    state.busy = true;
    const total = state.totalScore;
    const roundPts = state.roundScore;
    const { level, target } = state.cfg;
    const passed = total >= target;

    if (!passed) {
      showModal({
        title: "挑战失败",
        body: `当前得分 ${total}，未达到截至第 ${level} 关的目标 ${target} 分。\n将从头开始，关卡与分数全部清零。`,
        primaryText: "重新开始",
        onPrimary: () => startNewGame(),
      });
      return;
    }

    state.roundScore = 0;

    if (level >= LEVEL_COUNT) {
      window.gameAudio?.playGameClear?.();
      showModal({
        title: "通关！",
        body: `你已完成全部 ${LEVEL_COUNT} 关。\n最终得分 ${total}（本关内消除 ${roundPts} 分）。`,
        primaryText: "重新开始",
        onPrimary: () => startNewGame(),
      });
      return;
    }

    showModal({
      title: "恭喜过关",
      body: "",
      celebrate: true,
      primaryText: "进入下一关",
      onPrimary: () => advanceToLevel(level + 1, { showEnterSplash: true }),
    });
  }

  function finishTurn() {
    state.busy = false;
    if (!hasLegalMove(state.grid)) {
      endCurrentRound();
    }
  }

  function advanceToLevel(levelIndex, options = {}) {
    const { showEnterSplash = false } = options;
    const cfg = levelConfig(levelIndex);
    const grid = buildPlayableGrid(cfg);
    state.cfg = cfg;
    state.grid = grid;
    state.preview = null;
    levelEl.textContent = String(cfg.level);
    targetEl.textContent = String(cfg.target);
    totalScoreEl.textContent = String(state.totalScore);
    renderBoard();
    if (!hasLegalMove(state.grid)) {
      state.busy = false;
      showModal({
        title: "本关开局无解",
        body: "随机盘面无法继续，请点击重试重新生成。",
        primaryText: "重试",
        onPrimary: () => advanceToLevel(levelIndex, options),
      });
      return;
    }
    if (showEnterSplash) {
      window.gameAudio?.playLevelUp?.();
      showLevelUpSplash(() => {
        state.busy = false;
      });
    } else {
      state.busy = false;
    }
  }

  function startNewGame() {
    hideModal();
    startLevel(1);
  }

  function startLevel(levelIndex) {
    hideModal();
    const cfg = levelConfig(levelIndex);
    const grid = buildPlayableGrid(cfg);
    state = {
      cfg,
      grid,
      totalScore: 0,
      roundScore: 0,
      busy: false,
      preview: null,
    };
    levelEl.textContent = String(cfg.level);
    totalScoreEl.textContent = "0";
    targetEl.textContent = String(cfg.target);
    renderBoard();
    if (!hasLegalMove(state.grid)) {
      showModal({
        title: "本关开局无解",
        body: "随机盘面无法继续，请点击重试重新生成。",
        primaryText: "重试",
        onPrimary: () => startLevel(levelIndex),
      });
    }
  }

  function resolveCellFromPointerLike(e) {
    const t = e.target;
    if (t && t.nodeType === 1 && t.closest) {
      const hit = t.closest(".cell:not(.empty)");
      if (hit && boardEl.contains(hit)) return hit;
    }
    let x = e.clientX;
    let y = e.clientY;
    if ((x === undefined || y === undefined) && e.changedTouches && e.changedTouches[0]) {
      x = e.changedTouches[0].clientX;
      y = e.changedTouches[0].clientY;
    }
    if (typeof x !== "number" || typeof y !== "number" || Number.isNaN(x)) return null;
    const stack = document.elementsFromPoint(x, y);
    for (let i = 0; i < stack.length; i++) {
      const n = stack[i];
      if (!(n instanceof HTMLElement)) continue;
      if (!n.classList.contains("cell") || n.classList.contains("empty")) continue;
      if (!boardEl.contains(n)) continue;
      return n;
    }
    return null;
  }

  let lastActivate = { t: 0, r: -1, c: -1 };

  function activateCellFromEvent(e) {
    const cell = resolveCellFromPointerLike(e);
    if (!cell) return;
    const r = Number(cell.dataset.row);
    const c = Number(cell.dataset.col);
    const now = performance.now();
    if (now - lastActivate.t < 400 && lastActivate.r === r && lastActivate.c === c) return;
    lastActivate = { t: now, r, c };
    tryEliminate(r, c);
  }

  function onBoardActivateClick(e) {
    activateCellFromEvent(e);
  }

  function attachCellHandlers() {
    boardEl.querySelectorAll(".cell:not(.empty)").forEach((el) => {
      const r = Number(el.dataset.row);
      const c = Number(el.dataset.col);

      el.addEventListener("pointerenter", () => setPreviewFromPoint(r, c));
      el.addEventListener("pointerdown", () => {
        window.gameAudio?.playTap?.();
        setPreviewFromPoint(r, c);
      });
    });
  }

  /**
   * 切勿在 touch 的 pointerdown 上 preventDefault：在 iOS / 微信内置浏览器里会吃掉随后的 click，
   * 表现为「高亮连成一片（预览在）但怎么点都不消」。
   * 触控用 pointerup 主动消除；鼠标仍走 click，避免同一操作触发两次。
   */
  boardEl.addEventListener("pointerup", (e) => {
    if (e.pointerType === "mouse") return;
    activateCellFromEvent(e);
  });

  boardEl.addEventListener("click", onBoardActivateClick);

  boardEl.addEventListener("pointerleave", clearPreview);

  window.addEventListener("resize", () => {
    clearTimeout(boardAspectResizeTimer);
    boardAspectResizeTimer = setTimeout(updateBoardAspectRatio, 120);
  });

  const tapUi = () => window.gameAudio?.playTap?.();
  btnModalPrimary.addEventListener("pointerdown", tapUi);
  btnModalSecondary.addEventListener("pointerdown", tapUi);

  startLevel(1);
})();
