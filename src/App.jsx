import React, { useState, useEffect, useMemo, useRef } from "react";
import {
  Play,
  Pause,
  Edit3,
  Eye,
  RotateCcw,
  Info,
  Route,
  Trash2,
  CheckSquare,
  FileSpreadsheet,
  FileJson,
  Keyboard,
  ZoomIn,
} from "lucide-react";

const GRID_W = 56;
const GRID_H = 35;

const INITIAL_COLS = 9;
const INITIAL_ROWS = 19;
const INITIAL_GAP_COL = 4;
const INITIAL_GAP_ROWS = new Set([16, 17, 18]);

const DEFAULT_MAX_STEPS = 50;
const HARD_MAX_STEPS = 300;
const MIN_STEPS = 1;
const DEFAULT_STEPS = 50;

const STORAGE = {
  initial: "formatura_v9_initial",
  target: "formatura_v9_target",
  frames: "formatura_v9_frame_positions",
  steps: "formatura_v9_total_steps",
  unlock: "formatura_v9_unlock_steps",
  perspective: "formatura_v9_perspective",
};

const targetArt = [
  "                          ##                         ",
  " #########     ##    #########                       ",
  "  ########     ##    ########                        ",
  "  ########     ##    ########                        ",
  "     #######   ##   #######                          ",
  "     #######   ##   #######                          ",
  "       ######  ##  ######                            ",
  "       ######  ##  ######                            ",
  "        ###### ## ######                             ",
  "          ############                               ",
  "                 ######                              ",
  "                     ##                              ",
  "                    ##                               ",
  "                ######                               ",
  "                 ####                                ",
  "                   ##                                ",
  "                   ##                                ",
];

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

const normalizeStepCount = (value, allowMoreThan50 = false) => {
  const parsed = Number.parseInt(value, 10);
  if (Number.isNaN(parsed)) return MIN_STEPS;
  return clamp(parsed, MIN_STEPS, allowMoreThan50 ? HARD_MAX_STEPS : DEFAULT_MAX_STEPS);
};

const normalizeGridPoint = (pt) => ({
  x: clamp(Math.round(Number(pt?.x ?? 0)), 0, GRID_W - 1),
  y: clamp(Math.round(Number(pt?.y ?? 0)), 0, GRID_H - 1),
});

const pointKey = (pt) => `${Math.round(pt.x)},${Math.round(pt.y)}`;

const samePoint = (a, b) => {
  return Math.round(a.x) === Math.round(b.x) && Math.round(a.y) === Math.round(b.y);
};

const manhattan = (a, b) => {
  return Math.abs(Math.round(a.x) - Math.round(b.x)) + Math.abs(Math.round(a.y) - Math.round(b.y));
};

const formatCoord = (value) => String(Math.round(value));

const safeJsonParse = (key, fallback) => {
  try {
    const saved = localStorage.getItem(key);
    return saved ? JSON.parse(saved) : fallback;
  } catch {
    return fallback;
  }
};

const getColName = (colIndex) => {
  let name = "";
  let c = colIndex;

  while (c >= 0) {
    name = String.fromCharCode(65 + (c % 26)) + name;
    c = Math.floor(c / 26) - 1;
  }

  return name;
};

const getInitialBlockOffset = () => ({
  x: Math.floor((GRID_W - INITIAL_COLS) / 2),
  y: Math.floor((GRID_H - INITIAL_ROWS) / 2),
});

const getRelativeBlockLabelFromGridPoint = (pt) => {
  const offset = getInitialBlockOffset();
  const relX = Math.round(pt.x) - offset.x;
  const relY = Math.round(pt.y) - offset.y;

  if (relX >= 0 && relX < INITIAL_COLS && relY >= 0 && relY < INITIAL_ROWS) {
    return `${getColName(relX)}${relY + 1}`;
  }

  return `P${Math.round(pt.x) + 1}-${Math.round(pt.y) + 1}`;
};

const makeUniqueCadetId = (baseId, points) => {
  if (!points.some((p) => p.id === baseId)) return baseId;

  let count = 2;
  let nextId = `${baseId}_${count}`;

  while (points.some((p) => p.id === nextId)) {
    count += 1;
    nextId = `${baseId}_${count}`;
  }

  return nextId;
};

const generateInitialFormation = () => {
  const pts = [];
  const offset = getInitialBlockOffset();

  for (let y = 0; y < INITIAL_ROWS; y++) {
    for (let x = 0; x < INITIAL_COLS; x++) {
      if (x === INITIAL_GAP_COL && INITIAL_GAP_ROWS.has(y)) continue;

      const label = `${getColName(x)}${y + 1}`;

      pts.push({
        id: label,
        label,
        x: offset.x + x,
        y: offset.y + y,
        originalX: x,
        originalY: y + 1,
      });
    }
  }

  return pts;
};

const generateFormationFromArt = (art) => {
  const pts = [];
  const artWidth = Math.max(...art.map((line) => line.length));
  const offsetX = Math.max(0, Math.floor((GRID_W - artWidth) / 2));
  const offsetY = Math.max(0, Math.floor((GRID_H - art.length) / 2));

  for (let y = 0; y < art.length; y++) {
    for (let x = 0; x < art[y].length; x++) {
      if (art[y][x] === "#") pts.push({ x: x + offsetX, y: y + offsetY });
    }
  }

  return pts;
};

const generateTargetFormation = () => {
  const target = generateFormationFromArt(targetArt);
  const initialCount = generateInitialFormation().length;

  if (target.length === initialCount) return target;
  if (target.length > initialCount) return target.slice(0, initialCount);

  const used = new Set(target.map(pointKey));
  const expanded = [...target];
  const center = { x: Math.floor(GRID_W / 2), y: Math.floor(GRID_H / 2) };
  const allCells = [];

  for (let y = 0; y < GRID_H; y++) {
    for (let x = 0; x < GRID_W; x++) {
      const pt = { x, y };
      if (!used.has(pointKey(pt))) allCells.push(pt);
    }
  }

  allCells.sort((a, b) => manhattan(a, center) - manhattan(b, center));

  while (expanded.length < initialCount && allCells.length > 0) expanded.push(allCells.shift());
  return expanded;
};

const getViewSize = (perspective) => {
  return perspective % 180 === 0
    ? { w: GRID_W, h: GRID_H }
    : { w: GRID_H, h: GRID_W };
};

const toViewPoint = (pt, perspective) => {
  const p = normalizeGridPoint(pt);

  if (perspective === 90) return { x: GRID_H - 1 - p.y, y: p.x };
  if (perspective === 180) return { x: GRID_W - 1 - p.x, y: GRID_H - 1 - p.y };
  if (perspective === 270) return { x: p.y, y: GRID_W - 1 - p.x };
  return { x: p.x, y: p.y };
};

const fromViewPoint = (pt, perspective) => {
  const x = Math.floor(pt.x);
  const y = Math.floor(pt.y);

  if (perspective === 90) return normalizeGridPoint({ x: y, y: GRID_H - 1 - x });
  if (perspective === 180) return normalizeGridPoint({ x: GRID_W - 1 - x, y: GRID_H - 1 - y });
  if (perspective === 270) return normalizeGridPoint({ x: GRID_W - 1 - y, y: x });
  return normalizeGridPoint({ x, y });
};

const getFrameEntries = (frames, totalSteps) => {
  if (!frames) return [];

  return Object.entries(frames)
    .map(([step, pt]) => ({ step: Number.parseInt(step, 10), pt: normalizeGridPoint(pt) }))
    .filter(({ step }) => Number.isInteger(step) && step >= 1 && step <= totalSteps)
    .sort((a, b) => a.step - b.step);
};

const buildManualPaths = (initialPoints, framePositions, totalSteps, targetPoints) => {
  const targetSet = new Set(targetPoints.map(pointKey));

  return initialPoints.map((pt) => {
    const frames = framePositions?.[pt.id] || {};
    const path = [normalizeGridPoint({ x: pt.x, y: pt.y })];

    for (let step = 1; step <= totalSteps; step++) {
      const manualPoint = frames[step];
      const previous = path[step - 1];
      path.push(manualPoint ? normalizeGridPoint(manualPoint) : previous);
    }

    const finalPoint = path[path.length - 1];

    return {
      id: pt.id,
      label: pt.label || pt.id,
      originalX: pt.originalX,
      originalY: pt.originalY,
      startX: pt.x,
      startY: pt.y,
      frames,
      path,
      isOnFinalTarget: targetSet.has(pointKey(finalPoint)),
    };
  });
};

const getCadetPointAtStep = (cadet, step) => {
  if (!cadet?.path?.length) return { x: 0, y: 0 };
  const index = clamp(Math.round(step), 0, cadet.path.length - 1);
  return cadet.path[index];
};

const countManualFrames = (framePositions) => {
  return Object.values(framePositions || {}).reduce((total, frames) => total + Object.keys(frames || {}).length, 0);
};

const validateManualPlan = (cadetsData, totalSteps) => {
  let sameCellCollisions = 0;
  let directSwaps = 0;
  let longMoves = 0;

  for (let step = 0; step <= totalSteps; step++) {
    const occupied = new Map();

    cadetsData.forEach((cadet) => {
      const pt = getCadetPointAtStep(cadet, step);
      const key = pointKey(pt);
      if (occupied.has(key)) sameCellCollisions += 1;
      occupied.set(key, cadet.id);
    });
  }

  for (let step = 1; step <= totalSteps; step++) {
    for (let i = 0; i < cadetsData.length; i++) {
      const a = cadetsData[i];
      const aPrev = getCadetPointAtStep(a, step - 1);
      const aNow = getCadetPointAtStep(a, step);

      if (manhattan(aPrev, aNow) > 1) longMoves += 1;

      for (let j = i + 1; j < cadetsData.length; j++) {
        const b = cadetsData[j];
        const bPrev = getCadetPointAtStep(b, step - 1);
        const bNow = getCadetPointAtStep(b, step);

        if (samePoint(aPrev, bNow) && samePoint(aNow, bPrev) && !samePoint(aNow, aPrev)) directSwaps += 1;
      }
    }
  }

  return { sameCellCollisions, directSwaps, longMoves };
};

export default function App() {
  const [mode, setMode] = useState("view");
  const [allowMoreThan50, setAllowMoreThan50] = useState(() => Boolean(safeJsonParse(STORAGE.unlock, false)));
  const [perspective, setPerspective] = useState(() => safeJsonParse(STORAGE.perspective, 0));

  const [initialPoints, setInitialPoints] = useState(() => safeJsonParse(STORAGE.initial, generateInitialFormation()));
  const [targetPoints, setTargetPoints] = useState(() => safeJsonParse(STORAGE.target, generateTargetFormation()));
  const [framePositions, setFramePositions] = useState(() => safeJsonParse(STORAGE.frames, {}));

  const [totalSteps, setTotalSteps] = useState(() => {
    const allow = Boolean(safeJsonParse(STORAGE.unlock, false));
    return normalizeStepCount(safeJsonParse(STORAGE.steps, DEFAULT_STEPS), allow);
  });

  const [draftFramePositions, setDraftFramePositions] = useState({});
  const [selectedStep, setSelectedStep] = useState(1);
  const [progress, setProgress] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [animationSpeed, setAnimationSpeed] = useState(1);

  const [hoveredCadet, setHoveredCadet] = useState(null);
  const [selectedCadets, setSelectedCadets] = useState([]);
  const [selectionBox, setSelectionBox] = useState(null);
  const [pendingMove, setPendingMove] = useState(null);

  const viewSize = useMemo(() => getViewSize(perspective), [perspective]);
  const [viewBox, setViewBox] = useState({ x: 0, y: 0, w: GRID_W, h: GRID_H });

  const animationRef = useRef(null);
  const svgRef = useRef(null);

  useEffect(() => localStorage.setItem(STORAGE.initial, JSON.stringify(initialPoints)), [initialPoints]);
  useEffect(() => localStorage.setItem(STORAGE.target, JSON.stringify(targetPoints)), [targetPoints]);
  useEffect(() => localStorage.setItem(STORAGE.frames, JSON.stringify(framePositions)), [framePositions]);
  useEffect(() => localStorage.setItem(STORAGE.steps, JSON.stringify(totalSteps)), [totalSteps]);
  useEffect(() => localStorage.setItem(STORAGE.unlock, JSON.stringify(allowMoreThan50)), [allowMoreThan50]);
  useEffect(() => localStorage.setItem(STORAGE.perspective, JSON.stringify(perspective)), [perspective]);

  useEffect(() => {
    setViewBox({ x: 0, y: 0, w: viewSize.w, h: viewSize.h });
  }, [viewSize.w, viewSize.h]);

  const cadetsData = useMemo(() => buildManualPaths(initialPoints, framePositions, totalSteps, targetPoints), [initialPoints, framePositions, totalSteps, targetPoints]);
  const draftCadetsData = useMemo(() => buildManualPaths(initialPoints, draftFramePositions, totalSteps, targetPoints), [initialPoints, draftFramePositions, totalSteps, targetPoints]);

  const activeCadetsData = mode === "edit_path" ? draftCadetsData : cadetsData;
  const activeFramePositions = mode === "edit_path" ? draftFramePositions : framePositions;

  const pointsCountMismatch = initialPoints.length !== targetPoints.length;
  const manualFramesCount = countManualFrames(activeFramePositions);
  const notOnFinalTargetCount = activeCadetsData.filter((cadet) => !cadet.isOnFinalTarget).length;
  const validation = validateManualPlan(activeCadetsData, totalSteps);
  const maxStepInput = allowMoreThan50 ? HARD_MAX_STEPS : DEFAULT_MAX_STEPS;
  const zoomPercent = Math.round((viewSize.w / viewBox.w) * 100);

  const selectedOne = selectedCadets.length === 1 ? activeCadetsData.find((cadet) => cadet.id === selectedCadets[0]) : null;
  const selectedOneManualSteps = selectedOne ? getFrameEntries(draftFramePositions[selectedOne.id], totalSteps).map(({ step }) => step) : [];
  const currentDisplayStep = mode === "edit_path" ? selectedStep : progress;

  useEffect(() => {
    if (mode === "edit_path") setProgress(selectedStep);
  }, [mode, selectedStep]);

  useEffect(() => {
    if (!isPlaying) return undefined;

    let lastTime = performance.now();
    let accumulator = 0;

    const loop = (time) => {
      const dt = Math.max(0, (time - lastTime) / 1000);
      lastTime = time;
      accumulator += dt * animationSpeed;

      if (accumulator >= 1) {
        const stepsToAdvance = Math.floor(accumulator);
        accumulator -= stepsToAdvance;

        setProgress((prev) => {
          const next = clamp(prev + stepsToAdvance, 0, totalSteps);
          if (next >= totalSteps) {
            setIsPlaying(false);
            return totalSteps;
          }
          return next;
        });
      }

      animationRef.current = requestAnimationFrame(loop);
    };

    animationRef.current = requestAnimationFrame(loop);
    return () => {
      if (animationRef.current) cancelAnimationFrame(animationRef.current);
    };
  }, [isPlaying, animationSpeed, totalSteps]);

  const getSvgPt = (e) => {
    const svg = svgRef.current;
    if (!svg || !svg.getScreenCTM()) return { x: 0, y: 0 };

    const pt = svg.createSVGPoint();
    pt.x = e.clientX;
    pt.y = e.clientY;
    return pt.matrixTransform(svg.getScreenCTM().inverse());
  };

  const handleWheel = (e) => {
    e.preventDefault();
    const mousePt = getSvgPt(e);
    const factor = e.deltaY > 0 ? 1.12 : 0.88;

    setViewBox((prev) => {
      const minW = Math.min(8, viewSize.w);
      let nextW = clamp(prev.w * factor, minW, viewSize.w);
      let nextH = nextW * (viewSize.h / viewSize.w);

      if (nextH > viewSize.h) {
        nextH = viewSize.h;
        nextW = viewSize.w;
      }

      const ratioW = nextW / prev.w;
      const ratioH = nextH / prev.h;
      const nextX = clamp(mousePt.x - (mousePt.x - prev.x) * ratioW, 0, viewSize.w - nextW);
      const nextY = clamp(mousePt.y - (mousePt.y - prev.y) * ratioH, 0, viewSize.h - nextH);

      return { x: nextX, y: nextY, w: nextW, h: nextH };
    });
  };

  const resetZoom = () => setViewBox({ x: 0, y: 0, w: viewSize.w, h: viewSize.h });

  const handleStepCountChange = (value, nextAllow = allowMoreThan50) => {
    const next = normalizeStepCount(value, nextAllow);
    setTotalSteps(next);
    setProgress((prev) => clamp(Math.round(prev), 0, next));
    setSelectedStep((prev) => clamp(Math.round(prev), 1, next));
    setIsPlaying(false);
  };

  const toggleAllowMoreThan50 = (checked) => {
    setAllowMoreThan50(checked);
    if (!checked && totalSteps > DEFAULT_MAX_STEPS) handleStepCountChange(DEFAULT_MAX_STEPS, false);
  };

  const togglePlay = () => {
    if (progress >= totalSteps) setProgress(0);
    setIsPlaying((prev) => !prev);
  };

  const resetAnimation = () => {
    setIsPlaying(false);
    setProgress(0);
  };

  const setBothFrameStates = (updater) => {
    setDraftFramePositions((prev) => {
      const next = updater(prev);
      setFramePositions(next);
      return next;
    });
  };

  const addFramePosition = (prev, cadetId, step, pt) => {
    const normalizedStep = clamp(Math.round(step), 1, totalSteps);
    const next = { ...prev };
    next[cadetId] = { ...(next[cadetId] || {}), [normalizedStep]: normalizeGridPoint(pt) };
    return next;
  };

  const getSelectedData = () => selectedCadets.map((id) => activeCadetsData.find((cadet) => cadet.id === id)).filter(Boolean);

  const evaluatePendingPositions = (positions) => {
    const seen = new Set();

    for (const { pt } of positions) {
      const key = pointKey(pt);
      if (seen.has(key)) return { blocked: true, reason: "Dois selecionados ficariam no mesmo quadrado." };
      seen.add(key);
    }

    for (const { id, pt } of positions) {
      const cadet = activeCadetsData.find((c) => c.id === id);
      if (!cadet) continue;

      const previousPt = getCadetPointAtStep(cadet, selectedStep - 1);
      if (manhattan(previousPt, pt) > 1) return { blocked: true, reason: "Movimento maior que 1 quadrado. Use um passo intermediário." };
    }

    for (const cadet of activeCadetsData) {
      if (selectedCadets.includes(cadet.id)) continue;

      const unselectedNow = getCadetPointAtStep(cadet, selectedStep);
      const unselectedPrev = getCadetPointAtStep(cadet, selectedStep - 1);

      for (const { id, pt } of positions) {
        const selectedCadet = activeCadetsData.find((c) => c.id === id);
        if (!selectedCadet) continue;

        const selectedPrev = getCadetPointAtStep(selectedCadet, selectedStep - 1);

        if (samePoint(pt, unselectedNow)) return { blocked: true, reason: "Este quadrado já está ocupado por outro cadete neste passo." };

        if (samePoint(selectedPrev, unselectedNow) && samePoint(pt, unselectedPrev) && !samePoint(selectedPrev, pt)) {
          return { blocked: true, reason: "Troca direta detectada. Isso causaria atravessamento." };
        }
      }
    }

    for (let i = 0; i < positions.length; i++) {
      const a = positions[i];
      const aCadet = activeCadetsData.find((c) => c.id === a.id);
      if (!aCadet) continue;
      const aPrev = getCadetPointAtStep(aCadet, selectedStep - 1);

      for (let j = i + 1; j < positions.length; j++) {
        const b = positions[j];
        const bCadet = activeCadetsData.find((c) => c.id === b.id);
        if (!bCadet) continue;
        const bPrev = getCadetPointAtStep(bCadet, selectedStep - 1);

        if (samePoint(a.pt, bPrev) && samePoint(b.pt, aPrev)) return { blocked: true, reason: "Troca direta entre selecionados detectada." };
      }
    }

    return { blocked: false, reason: "Confirmado: posição salva na coreografia." };
  };

  const startOrUpdatePendingMove = (positions) => {
    if (positions.length === 0) return;

    const normalized = positions.map(({ id, pt }) => ({ id, pt: normalizeGridPoint(pt) }));
    const evaluation = evaluatePendingPositions(normalized);

    setPendingMove({
      positions: Object.fromEntries(normalized.map(({ id, pt }) => [id, pt])),
      blocked: evaluation.blocked,
      reason: evaluation.reason,
    });
  };

  const calculateShiftedPositions = (dx, dy) => {
    return getSelectedData().map((cadet) => {
      const basePt = pendingMove?.positions?.[cadet.id] || getCadetPointAtStep(cadet, selectedStep);
      return { id: cadet.id, pt: { x: clamp(basePt.x + dx, 0, GRID_W - 1), y: clamp(basePt.y + dy, 0, GRID_H - 1) } };
    });
  };

  const nudgeSelection = (dx, dy) => {
    if (mode !== "edit_path" || selectedCadets.length === 0) return;
    startOrUpdatePendingMove(calculateShiftedPositions(dx, dy));
  };

  const confirmPendingMove = () => {
    if (!pendingMove || pendingMove.blocked) return;

    const positions = pendingMove.positions;

    setBothFrameStates((prev) => {
      let next = { ...prev };
      Object.entries(positions).forEach(([id, pt]) => {
        next = addFramePosition(next, id, selectedStep, pt);
      });
      return next;
    });

    setPendingMove(null);
  };

  const cancelPendingMove = () => setPendingMove(null);

  useEffect(() => {
    const handleKeyDown = (e) => {
      if (mode !== "edit_path") return;
      if (["INPUT", "TEXTAREA", "SELECT"].includes(document.activeElement?.tagName)) return;

      if (e.key === "ArrowUp") {
        e.preventDefault();
        nudgeSelection(0, -1);
      } else if (e.key === "ArrowDown") {
        e.preventDefault();
        nudgeSelection(0, 1);
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        nudgeSelection(-1, 0);
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        nudgeSelection(1, 0);
      } else if (e.key === "Enter") {
        e.preventDefault();
        confirmPendingMove();
      } else if (e.key === "Escape") {
        e.preventDefault();
        cancelPendingMove();
        setSelectedCadets([]);
      } else if (e.key === "Delete" || e.key === "Backspace") {
        e.preventDefault();
        deleteSelectedStepFrame();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  });

  const handleGridClick = (viewX, viewY, event) => {
    const gridPt = fromViewPoint({ x: viewX, y: viewY }, perspective);

    if (mode === "edit_initial") {
      toggleInitialCells([gridPt]);
      return;
    }

    if (mode === "edit_target") {
      toggleTargetCells([gridPt]);
      return;
    }

    if (mode === "edit_path") {
      const cadetAtPoint = activeCadetsData.find((cadet) => samePoint(getCadetPointAtStep(cadet, selectedStep), gridPt));

      if (cadetAtPoint) {
        setSelectedCadets((prev) => {
          if (event?.shiftKey) return prev.includes(cadetAtPoint.id) ? prev.filter((id) => id !== cadetAtPoint.id) : [...prev, cadetAtPoint.id];
          return [cadetAtPoint.id];
        });
      } else {
        setSelectedCadets([]);
      }

      setPendingMove(null);
    }
  };

  const getCellsInsideViewBox = (box) => {
    const minX = Math.min(box.startX, box.currentX);
    const maxX = Math.max(box.startX, box.currentX);
    const minY = Math.min(box.startY, box.currentY);
    const maxY = Math.max(box.startY, box.currentY);
    const cells = [];

    for (let y = 0; y < GRID_H; y++) {
      for (let x = 0; x < GRID_W; x++) {
        const viewPt = toViewPoint({ x, y }, perspective);
        const center = { x: viewPt.x + 0.5, y: viewPt.y + 0.5 };
        if (center.x >= minX && center.x <= maxX && center.y >= minY && center.y <= maxY) cells.push({ x, y });
      }
    }

    return cells;
  };

  const toggleInitialCells = (cells) => {
    setInitialPoints((prev) => {
      let next = [...prev];

      cells.forEach((gridPt) => {
        const exists = next.find((p) => p.x === gridPt.x && p.y === gridPt.y);
        if (exists) {
          next = next.filter((p) => p.x !== gridPt.x || p.y !== gridPt.y);
        } else {
          const baseLabel = getRelativeBlockLabelFromGridPoint(gridPt);
          const id = makeUniqueCadetId(baseLabel, next);
          const offset = getInitialBlockOffset();

          next.push({
            id,
            label: baseLabel,
            x: gridPt.x,
            y: gridPt.y,
            originalX: gridPt.x - offset.x,
            originalY: gridPt.y - offset.y + 1,
          });
        }
      });

      return next;
    });
  };

  const toggleTargetCells = (cells) => {
    setTargetPoints((prev) => {
      let next = [...prev];

      cells.forEach((gridPt) => {
        const exists = next.find((p) => p.x === gridPt.x && p.y === gridPt.y);
        if (exists) next = next.filter((p) => p.x !== gridPt.x || p.y !== gridPt.y);
        else next.push({ x: gridPt.x, y: gridPt.y });
      });

      return next;
    });
  };

  const handlePointerDown = (e) => {
    if (!["edit_path", "edit_initial", "edit_target"].includes(mode)) return;
    const pt = getSvgPt(e);
    setSelectionBox({ startX: pt.x, startY: pt.y, currentX: pt.x, currentY: pt.y, isDragging: false });
  };

  const handlePointerMove = (e) => {
    if (!selectionBox || !["edit_path", "edit_initial", "edit_target"].includes(mode)) return;
    const pt = getSvgPt(e);
    const dx = Math.abs(pt.x - selectionBox.startX);
    const dy = Math.abs(pt.y - selectionBox.startY);
    if (dx > 0.5 || dy > 0.5) setSelectionBox((prev) => ({ ...prev, currentX: pt.x, currentY: pt.y, isDragging: true }));
  };

  const handlePointerUp = (e) => {
    if (!["edit_path", "edit_initial", "edit_target"].includes(mode) || !selectionBox) return;
    const pt = getSvgPt(e);
    const finalBox = { ...selectionBox, currentX: pt.x, currentY: pt.y };

    if (!selectionBox.isDragging) {
      handleGridClick(Math.floor(selectionBox.startX), Math.floor(selectionBox.startY), e);
      setSelectionBox(null);
      return;
    }

    if (mode === "edit_initial") toggleInitialCells(getCellsInsideViewBox(finalBox));
    else if (mode === "edit_target") toggleTargetCells(getCellsInsideViewBox(finalBox));
    else {
      const minX = Math.min(finalBox.startX, finalBox.currentX);
      const maxX = Math.max(finalBox.startX, finalBox.currentX);
      const minY = Math.min(finalBox.startY, finalBox.currentY);
      const maxY = Math.max(finalBox.startY, finalBox.currentY);

      const selectedIds = activeCadetsData
        .filter((cadet) => {
          const gridPt = getCadetPointAtStep(cadet, selectedStep);
          const viewPt = toViewPoint(gridPt, perspective);
          const center = { x: viewPt.x + 0.5, y: viewPt.y + 0.5 };
          return center.x >= minX && center.x <= maxX && center.y >= minY && center.y <= maxY;
        })
        .map((cadet) => cadet.id);

      setSelectedCadets((prev) => (e.shiftKey ? [...new Set([...prev, ...selectedIds])] : selectedIds));
      setPendingMove(null);
    }

    setSelectionBox(null);
  };

  const enterDraftMode = () => {
    setDraftFramePositions(framePositions);
    setSelectedStep(clamp(Math.max(1, Math.round(progress)), 1, totalSteps));
    setSelectedCadets([]);
    setPendingMove(null);
    setMode("edit_path");
    setIsPlaying(false);
  };

  const applyDraft = () => {
    setFramePositions(draftFramePositions);
    setMode("view");
    setSelectedCadets([]);
    setPendingMove(null);
    setProgress(selectedStep);
    setIsPlaying(false);
  };

  const cancelDraft = () => {
    setDraftFramePositions(framePositions);
    setMode("view");
    setSelectedCadets([]);
    setPendingMove(null);
    setIsPlaying(false);
  };

  function deleteSelectedStepFrame() {
    if (selectedCadets.length === 0) return;

    setBothFrameStates((prev) => {
      const next = { ...prev };
      selectedCadets.forEach((id) => {
        if (!next[id]) return;
        const updatedFrames = { ...next[id] };
        delete updatedFrames[selectedStep];
        if (Object.keys(updatedFrames).length === 0) delete next[id];
        else next[id] = updatedFrames;
      });
      return next;
    });

    setPendingMove(null);
  }

  const clearSelectedConfig = () => {
    if (selectedCadets.length === 0) return;
    setBothFrameStates((prev) => {
      const next = { ...prev };
      selectedCadets.forEach((id) => delete next[id]);
      return next;
    });
    setPendingMove(null);
  };

  const clearAllRoutes = () => {
    if (window.confirm("Deseja apagar todas as posições/quadro-a-quadro editadas?")) {
      setBothFrameStates(() => ({}));
      setPendingMove(null);
    }
  };

  const resetInitialBlock = () => {
    if (window.confirm("Restaurar a posição inicial para o bloco 9x19?")) {
      setInitialPoints(generateInitialFormation());
      setFramePositions({});
      setDraftFramePositions({});
      setPendingMove(null);
    }
  };

  const resetTargetGladio = () => {
    if (window.confirm("Restaurar o alvo final para o gládio?")) {
      setTargetPoints(generateTargetFormation());
      setFramePositions({});
      setDraftFramePositions({});
      setPendingMove(null);
    }
  };

  const resetToDefault = () => {
    if (window.confirm("Deseja apagar todas as edições e voltar ao formato original?")) {
      setInitialPoints(generateInitialFormation());
      setTargetPoints(generateTargetFormation());
      setFramePositions({});
      setDraftFramePositions({});
      setAllowMoreThan50(false);
      setTotalSteps(DEFAULT_STEPS);
      setSelectedStep(1);
      setProgress(0);
      setSelectedCadets([]);
      setPendingMove(null);
      setPerspective(0);
      setMode("view");
      setIsPlaying(false);
    }
  };

  const renameSelectedCadet = (newLabel) => {
    if (!selectedOne) return;
    setInitialPoints((prev) => prev.map((p) => (p.id === selectedOne.id ? { ...p, label: newLabel || p.id } : p)));
  };

  const exportCSV = () => {
    let csvContent = "data:text/csv;charset=utf-8,";
    let header = "Cadete";
    for (let i = 0; i <= totalSteps; i++) header += `,Passo ${i}`;
    csvContent += `${header}
`;

    cadetsData.forEach((cadet) => {
      let row = cadet.label || cadet.id;
      for (let i = 0; i <= totalSteps; i++) {
        const pt = getCadetPointAtStep(cadet, i);
        row += `,"(${formatCoord(pt.x)}, ${formatCoord(pt.y)})"`;
      }
      csvContent += `${row}
`;
    });

    const link = document.createElement("a");
    link.setAttribute("href", encodeURI(csvContent));
    link.setAttribute("download", "Roteiro_Formatura.csv");
    document.body.appendChild(link);
    link.click();
    link.remove();
  };

  const exportJSON = () => {
    const data = { initialPoints, targetPoints, framePositions, totalSteps, allowMoreThan50, perspective, version: 9, mode: "manual" };
    const encoded = `data:text/json;charset=utf-8,${encodeURIComponent(JSON.stringify(data, null, 2))}`;
    const link = document.createElement("a");
    link.setAttribute("href", encoded);
    link.setAttribute("download", "Projeto_Formatura.json");
    document.body.appendChild(link);
    link.click();
    link.remove();
  };

  const perspectiveLabel = {
    0: "Frente",
    90: "Lateral direita",
    180: "Costas",
    270: "Lateral esquerda",
  }[perspective];

  return (
    <div className="h-screen overflow-hidden bg-slate-900 text-slate-100 flex flex-col md:flex-row font-sans selection:bg-blue-500/30 overscroll-none">
      <div className="w-full md:w-[430px] h-screen bg-slate-800 p-4 flex flex-col border-r border-slate-700 shadow-xl overflow-hidden shrink-0 z-10">
        <h1 className="text-xl font-bold mb-1 text-white tracking-wide">Formatura Militar</h1>
        <p className="text-xs text-slate-400 mb-3">Coreografia manual com setas, zoom e perspectiva</p>

        <div className="flex flex-wrap bg-slate-900 rounded-lg p-1 mb-3 gap-1">
          <button onClick={() => { setMode("view"); setIsPlaying(false); setSelectedCadets([]); setPendingMove(null); }} className={`flex-1 py-2 text-[11px] font-semibold rounded flex justify-center items-center gap-1 ${mode === "view" ? "bg-blue-600 text-white shadow" : "text-slate-400 hover:text-white"}`}><Eye size={13} /> Animação</button>
          <button onClick={() => { setMode("edit_initial"); resetAnimation(); setSelectedCadets([]); setPendingMove(null); }} className={`flex-1 py-2 text-[11px] font-semibold rounded flex justify-center items-center gap-1 ${mode === "edit_initial" ? "bg-slate-700 text-white shadow" : "text-slate-400 hover:text-white"}`}><Edit3 size={13} /> Início</button>
          <button onClick={() => { setMode("edit_target"); resetAnimation(); setSelectedCadets([]); setPendingMove(null); }} className={`flex-1 py-2 text-[11px] font-semibold rounded flex justify-center items-center gap-1 ${mode === "edit_target" ? "bg-slate-700 text-white shadow" : "text-slate-400 hover:text-white"}`}><Edit3 size={13} /> Final</button>
          <button onClick={enterDraftMode} className={`flex-1 py-2 text-[11px] font-semibold rounded flex justify-center items-center gap-1 ${mode === "edit_path" ? "bg-amber-600 text-white shadow" : "text-slate-400 hover:text-white"}`}><Route size={13} /> Coreografia</button>
        </div>

        <div className="mb-3 p-3 rounded-lg bg-slate-900 border border-slate-700 space-y-2 text-xs">
          <div className="grid grid-cols-2 gap-2">
            <div className="flex justify-between gap-2"><span className="text-slate-400">Cadetes</span><b>{initialPoints.length}</b></div>
            <div className="flex justify-between gap-2"><span className="text-slate-400">Gládio</span><b className={pointsCountMismatch ? "text-red-400" : "text-green-400"}>{targetPoints.length}</b></div>
            <div className="flex justify-between gap-2"><span className="text-slate-400">Quadros</span><b className="text-amber-400">{manualFramesCount}</b></div>
            <div className="flex justify-between gap-2"><span className="text-slate-400">Zoom</span><b className="text-blue-400">{zoomPercent}%</b></div>
          </div>

          <div className="border-t border-slate-700 pt-2">
            <label className="text-slate-300 flex justify-between mb-1">Passos <span className="font-mono text-emerald-400">{totalSteps} / {maxStepInput}</span></label>
            <div className="flex gap-2">
              <input type="range" min={MIN_STEPS} max={maxStepInput} step="1" value={totalSteps} onChange={(e) => handleStepCountChange(e.target.value)} className="w-full h-2 bg-slate-700 rounded-lg appearance-none cursor-pointer accent-emerald-500" />
              <input type="number" min={MIN_STEPS} max={maxStepInput} value={totalSteps} onChange={(e) => handleStepCountChange(e.target.value)} className="w-20 bg-slate-800 border border-slate-600 rounded px-2 py-1 text-center font-mono text-xs" />
            </div>
            <label className="mt-2 flex items-center gap-2 text-[11px] text-slate-300"><input type="checkbox" checked={allowMoreThan50} onChange={(e) => toggleAllowMoreThan50(e.target.checked)} className="accent-emerald-500" />Permitir mais de 50 passos</label>
          </div>

          <div className="grid grid-cols-2 gap-2 border-t border-slate-700 pt-2">
            <button onClick={() => setPerspective((prev) => (prev + 90) % 360)} className="py-2 bg-slate-800 hover:bg-slate-700 rounded border border-slate-700">Girar: {perspectiveLabel}</button>
            <button onClick={resetZoom} className="py-2 bg-slate-800 hover:bg-slate-700 rounded border border-slate-700 flex items-center justify-center gap-1"><ZoomIn size={13} /> Reset zoom</button>
          </div>

          {notOnFinalTargetCount > 0 && <div className="bg-amber-950/40 border border-amber-900/60 rounded p-2 text-amber-200 flex gap-2"><Info size={13} className="shrink-0 mt-0.5" /><span>{notOnFinalTargetCount} cadete(s) fora do gládio no último passo.</span></div>}
          {(validation.sameCellCollisions > 0 || validation.directSwaps > 0 || validation.longMoves > 0) && <div className="bg-red-950/40 border border-red-900/60 rounded p-2 text-red-200 flex gap-2"><Info size={13} className="shrink-0 mt-0.5" /><span>Colisões: {validation.sameCellCollisions}, atravessamentos: {validation.directSwaps}, saltos: {validation.longMoves}.</span></div>}
        </div>

        {mode === "view" && (
          <div className="space-y-3 text-sm">
            <div className="space-y-2">
              <div className="flex justify-between"><span className="text-slate-300 font-medium">Tempo</span><span className="text-blue-400 font-mono font-bold">Passo {progress} / {totalSteps}</span></div>
              <input type="range" min="0" max={totalSteps} step="1" value={progress} onChange={(e) => { setProgress(Number.parseInt(e.target.value, 10)); setIsPlaying(false); }} className="w-full h-2 bg-slate-700 rounded-lg appearance-none cursor-pointer accent-blue-500" />
            </div>
            <div className="flex gap-2"><button onClick={togglePlay} className="flex-1 bg-blue-600 hover:bg-blue-500 text-white py-3 rounded-lg flex items-center justify-center gap-2 font-bold">{isPlaying ? <Pause size={18} /> : <Play size={18} />}{isPlaying ? "Pausar" : progress >= totalSteps ? "Reiniciar" : "Marcha"}</button><button onClick={resetAnimation} className="px-4 bg-slate-700 hover:bg-slate-600 text-white rounded-lg"><RotateCcw size={18} /></button></div>
            <div><label className="text-sm text-slate-300 flex justify-between mb-1">Velocidade <span className="font-mono">{animationSpeed.toFixed(1)} passos/s</span></label><input type="range" min="0.5" max="5" step="0.5" value={animationSpeed} onChange={(e) => setAnimationSpeed(Number.parseFloat(e.target.value))} className="w-full h-2 bg-slate-700 rounded-lg appearance-none cursor-pointer accent-slate-400" /></div>
            <div className="pt-3 border-t border-slate-700"><div className="flex flex-col gap-2"><button onClick={exportCSV} className="w-full py-2 bg-green-900/30 hover:bg-green-800/50 text-green-400 text-sm rounded flex items-center justify-center gap-2 border border-green-800/50"><FileSpreadsheet size={16} /> Planilha</button><button onClick={exportJSON} className="w-full py-2 bg-slate-700/50 hover:bg-slate-700 text-slate-300 text-sm rounded flex items-center justify-center gap-2 border border-slate-600"><FileJson size={16} /> Backup</button></div></div>
          </div>
        )}

        {mode === "edit_path" && (
          <div className="space-y-3 text-sm flex-1 overflow-hidden">
            <div className="bg-amber-900/20 border border-amber-800/50 rounded-lg p-3 text-amber-200 text-xs"><h3 className="font-bold flex items-center gap-2 mb-1 text-amber-500"><Route size={15} /> Coreografia Manual</h3><div>Selecione com clique/arrasto. Mova só pelas setas. Enter confirma e já salva. Clique vazio deseleciona.</div></div>
            <div className="bg-slate-900 border border-slate-700 rounded-lg p-3 space-y-2"><label className="text-slate-300 flex justify-between">Passo <span className="font-mono text-amber-400">{selectedStep} / {totalSteps}</span></label><input type="range" min="1" max={totalSteps} step="1" value={selectedStep} onChange={(e) => { setSelectedStep(clamp(Number.parseInt(e.target.value, 10), 1, totalSteps)); setPendingMove(null); }} className="w-full h-2 bg-slate-700 rounded-lg appearance-none cursor-pointer accent-amber-500" /><div className="flex gap-2"><button onClick={() => { setSelectedStep((prev) => clamp(prev - 1, 1, totalSteps)); setPendingMove(null); }} className="flex-1 py-2 bg-slate-800 hover:bg-slate-700 rounded border border-slate-700">Passo -</button><input type="number" min="1" max={totalSteps} value={selectedStep} onChange={(e) => { setSelectedStep(clamp(Number.parseInt(e.target.value || "1", 10), 1, totalSteps)); setPendingMove(null); }} className="w-20 bg-slate-800 border border-slate-600 rounded px-2 py-1 text-center font-mono text-xs" /><button onClick={() => { setSelectedStep((prev) => clamp(prev + 1, 1, totalSteps)); setPendingMove(null); }} className="flex-1 py-2 bg-slate-800 hover:bg-slate-700 rounded border border-slate-700">Passo +</button></div></div>
            {selectedCadets.length > 0 && <div className="bg-slate-900 border border-slate-700 rounded-lg p-3"><div className="flex items-center gap-2 mb-2"><div className="w-3 h-3 rounded-full bg-amber-400" /><span className="font-bold">Selecionados: {selectedCadets.length}</span></div>{selectedOne && <div className="mb-2"><label className="text-xs text-slate-400 block mb-1">Nome do quadrado</label><input value={selectedOne.label || selectedOne.id} onChange={(e) => renameSelectedCadet(e.target.value)} className="w-full bg-slate-800 border border-slate-600 rounded px-3 py-2 text-sm text-white" /></div>}{pendingMove && <div className={`mb-2 p-2 rounded text-xs border ${pendingMove.blocked ? "bg-red-950/40 border-red-900/60 text-red-200" : "bg-emerald-950/40 border-emerald-900/60 text-emerald-200"}`}>{pendingMove.reason}</div>}<div className="grid grid-cols-1 gap-2"><button onClick={confirmPendingMove} disabled={!pendingMove || pendingMove.blocked} className="w-full py-2 bg-emerald-700 hover:bg-emerald-600 disabled:bg-slate-700 disabled:text-slate-500 text-white rounded-md flex items-center justify-center gap-2 border border-emerald-800/50"><CheckSquare size={16} /> Confirmar local</button><button onClick={cancelPendingMove} disabled={!pendingMove} className="w-full py-2 bg-slate-700 hover:bg-slate-600 disabled:bg-slate-800 disabled:text-slate-600 text-white rounded-md">Cancelar prévia</button><button onClick={deleteSelectedStepFrame} className="w-full py-2 bg-red-950/50 hover:bg-red-900/70 text-red-200 rounded-md flex items-center justify-center gap-2 border border-red-900/60"><Trash2 size={16} /> Apagar passo {selectedStep}</button><button onClick={clearSelectedConfig} className="w-full py-2 bg-red-900/30 hover:bg-red-800/50 text-red-200 rounded-md flex items-center justify-center gap-2 border border-red-800/50"><Trash2 size={16} /> Apagar rota dos selecionados</button></div>{selectedOne && selectedOneManualSteps.length > 0 && <div className="mt-3 border-t border-slate-700 pt-2"><p className="text-xs text-slate-400 mb-1">Passos editados:</p><div className="flex flex-wrap gap-1">{selectedOneManualSteps.map((step) => <button key={step} onClick={() => { setSelectedStep(step); setPendingMove(null); }} className={`px-2 py-1 rounded text-xs border ${step === selectedStep ? "bg-amber-500 text-slate-950 border-amber-300" : "bg-slate-800 text-slate-300 border-slate-700 hover:bg-slate-700"}`}>{step}</button>)}</div></div>}</div>}
            <div className="bg-slate-900 border border-slate-700 rounded-lg p-3 text-xs text-slate-300 flex items-start gap-2"><Keyboard size={15} className="text-slate-500 shrink-0" /><span>Setas movem. Enter salva. Esc cancela/deseleciona. Delete apaga passo.</span></div>
            <div className="grid grid-cols-1 gap-2"><button onClick={clearAllRoutes} className="w-full py-2 bg-slate-900 hover:bg-slate-700 text-slate-300 text-sm rounded flex items-center justify-center gap-2 border border-slate-700"><Trash2 size={16} /> Apagar todas as posições</button><button onClick={cancelDraft} className="w-full py-2 bg-slate-700 hover:bg-slate-600 text-white text-sm rounded">Sair da coreografia</button></div>
          </div>
        )}

        {(mode === "edit_initial" || mode === "edit_target") && <div className="space-y-3 text-sm"><div className="bg-slate-900 border border-slate-700 rounded-lg p-3 text-slate-300">{mode === "edit_initial" ? "Clique para alternar 1 cadete. Arraste uma área para adicionar/remover vários da posição inicial." : "Clique para alternar 1 ponto. Arraste uma área para adicionar/remover vários pontos do gládio."}</div>{mode === "edit_initial" && <button onClick={resetInitialBlock} className="w-full py-2 bg-slate-700 hover:bg-slate-600 text-white rounded-md text-sm">Restaurar bloco 9x19</button>}{mode === "edit_target" && <button onClick={resetTargetGladio} className="w-full py-2 bg-slate-700 hover:bg-slate-600 text-white rounded-md text-sm">Restaurar gládio</button>}<button onClick={resetToDefault} className="w-full py-2 text-xs font-medium bg-red-950/30 hover:bg-red-900/50 text-red-400 rounded-md">Apagar Tudo e Restaurar Original</button></div>}

        {(mode === "view" || mode === "edit_path") && selectedCadets.length === 0 && <div className="mt-auto pt-3"><h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">Inspeção</h3><div className="bg-slate-900 border border-slate-700 rounded-lg p-3 min-h-24 flex flex-col justify-center">{hoveredCadet ? <><div className="flex items-center gap-2 mb-2"><div className="w-3 h-3 rounded-full bg-blue-400" /><span className="font-bold text-lg">{hoveredCadet.label || hoveredCadet.id}</span></div><div className="text-xs text-slate-400 grid grid-cols-2 gap-2"><div><span className="block text-slate-500">Início</span>({hoveredCadet.startX}, {hoveredCadet.startY})</div><div><span className="block text-slate-500">Neste passo</span>({formatCoord(getCadetPointAtStep(hoveredCadet, currentDisplayStep).x)}, {formatCoord(getCadetPointAtStep(hoveredCadet, currentDisplayStep).y)})</div></div></> : <div className="text-center text-slate-500 text-sm flex flex-col items-center gap-2"><Info size={18} className="text-slate-600 opacity-50" /><span className="opacity-70">Passe o mouse sobre um militar.</span></div>}</div></div>}
      </div>

      <div className="flex-1 h-screen bg-[#15171e] p-3 flex items-center justify-center overflow-hidden relative overscroll-none">
        <div className="w-full h-full max-w-7xl relative border border-slate-800 rounded-xl shadow-2xl bg-[#252830] overflow-hidden" style={{ aspectRatio: `${viewSize.w} / ${viewSize.h}` }}>
          <div className="absolute inset-0 opacity-10 pointer-events-none" style={{ backgroundImage: "linear-gradient(#fff 1px, transparent 1px), linear-gradient(90deg, #fff 1px, transparent 1px)", backgroundSize: `${100 / viewSize.w}% ${100 / viewSize.h}%` }} />
          <svg ref={svgRef} viewBox={`${viewBox.x} ${viewBox.y} ${viewBox.w} ${viewBox.h}`} className="w-full h-full touch-none" onWheel={handleWheel} onMouseLeave={() => { setHoveredCadet(null); setSelectionBox(null); }} onPointerDown={handlePointerDown} onPointerMove={handlePointerMove} onPointerUp={handlePointerUp}>
            {(mode === "edit_target" || mode === "edit_path" || mode === "view") && <g pointerEvents="none" opacity={mode === "view" ? 0.28 : 0.55}>{targetPoints.map((p, idx) => { const v = toViewPoint(p, perspective); return <rect key={`target-${idx}`} x={v.x} y={v.y} width={1} height={1} fill="#fbbf24" stroke="#92400e" strokeWidth="0.04" rx={0.08} />; })}</g>}

            {mode !== "view" && <g className={mode === "edit_path" ? "cursor-crosshair" : "cursor-pointer"}>{Array.from({ length: GRID_H }).map((_, y) => Array.from({ length: GRID_W }).map((_, x) => { const v = toViewPoint({ x, y }, perspective); let fill = "transparent"; if (mode === "edit_initial" && initialPoints.find((p) => p.x === x && p.y === y)) fill = "#94a3b8"; if (mode === "edit_target" && targetPoints.find((p) => p.x === x && p.y === y)) fill = "#fbbf24"; return <rect key={`${x}-${y}`} x={v.x} y={v.y} width={1} height={1} fill={fill} stroke="#4b5563" strokeWidth="0.045" className={mode !== "edit_path" ? "hover:fill-slate-600" : ""} />; }))}</g>}

            {mode === "edit_path" && selectedCadets.map((selId) => { const cadet = activeCadetsData.find((c) => c.id === selId); if (!cadet) return null; const manualFrames = getFrameEntries(draftFramePositions[selId], totalSteps); const currentGridPt = pendingMove?.positions?.[selId] || getCadetPointAtStep(cadet, selectedStep); const currentPt = toViewPoint(currentGridPt, perspective); const pathString = cadet.path.map((p, i) => { const v = toViewPoint(p, perspective); return `${i === 0 ? "M" : "L"} ${v.x + 0.5},${v.y + 0.5}`; }).join(" "); return <g key={`route-${selId}`} pointerEvents="none"><path d={pathString} fill="none" stroke="#f59e0b" strokeWidth="0.12" strokeDasharray="0.22 0.22" className="opacity-80" />{manualFrames.map(({ step, pt }) => { const v = toViewPoint(pt, perspective); return <g key={`${selId}-${step}`}><circle cx={v.x + 0.5} cy={v.y + 0.5} r={step === selectedStep ? 0.32 : 0.22} fill={step === selectedStep ? "#fde68a" : "#b45309"} stroke="#f59e0b" strokeWidth="0.08" /><text x={v.x + 0.5} y={v.y + 0.53} fontSize="0.24" textAnchor="middle" dominantBaseline="middle" fill="#111827" fontWeight="900">{step}</text></g>; })}<rect x={currentPt.x + 0.04} y={currentPt.y + 0.04} width={0.92} height={0.92} fill="none" stroke={pendingMove?.blocked ? "#ef4444" : "#38bdf8"} strokeWidth="0.13" rx={0.16} /></g>; })}

            {(mode === "view" || mode === "edit_path") && activeCadetsData.map((cadet) => { const stepToShow = mode === "edit_path" ? selectedStep : progress; const gridPt = pendingMove?.positions?.[cadet.id] || getCadetPointAtStep(cadet, stepToShow); const pt = toViewPoint(gridPt, perspective); const isHovered = hoveredCadet?.id === cadet.id; const isSelected = selectedCadets.includes(cadet.id); const isPending = Boolean(pendingMove?.positions?.[cadet.id]); let fillColor = "#f8fafc"; let strokeColor = "#0f172a"; let textColor = "#0f172a"; if (isPending && pendingMove?.blocked) { fillColor = "#ef4444"; strokeColor = "#ffffff"; textColor = "#ffffff"; } else if (isPending) { fillColor = "#34d399"; strokeColor = "#ffffff"; textColor = "#052e16"; } else if (isSelected) { fillColor = "#fbbf24"; strokeColor = "#ffffff"; textColor = "#111827"; } else if (isHovered) { fillColor = "#60a5fa"; strokeColor = "#ffffff"; textColor = "#ffffff"; } return <g key={cadet.id} transform={`translate(${pt.x}, ${pt.y})`} onMouseEnter={() => setHoveredCadet(cadet)} style={{ cursor: mode === "edit_path" ? "pointer" : "default", transition: isPlaying ? `transform ${Math.min(0.35, 0.9 / animationSpeed)}s linear` : "none" }}><rect x={0.025} y={0.025} width={0.95} height={0.95} fill={fillColor} stroke={strokeColor} strokeWidth={isSelected || isHovered || isPending ? "0.095" : "0.05"} rx={0.16} /><text x={0.5} y={0.52} fontSize="0.34" textAnchor="middle" dominantBaseline="middle" fill={textColor} fontWeight="900" stroke={textColor === "#ffffff" ? "#0f172a" : "rgba(255,255,255,0.55)"} strokeWidth={textColor === "#ffffff" ? "0.025" : "0.012"} style={{ userSelect: "none", paintOrder: "stroke", pointerEvents: "none" }}>{cadet.label || cadet.id}</text><ellipse cx={0.5} cy={0.91} rx={0.32} ry={0.08} fill="rgba(0,0,0,0.3)" pointerEvents="none" /></g>; })}

            {selectionBox && selectionBox.isDragging && <rect x={Math.min(selectionBox.startX, selectionBox.currentX)} y={Math.min(selectionBox.startY, selectionBox.currentY)} width={Math.abs(selectionBox.currentX - selectionBox.startX)} height={Math.abs(selectionBox.currentY - selectionBox.startY)} fill="rgba(96, 165, 250, 0.2)" stroke="#60a5fa" strokeWidth="0.1" pointerEvents="none" />}
          </svg>
          <div className="absolute right-3 bottom-3 bg-slate-950/80 border border-slate-700 rounded-lg px-3 py-2 text-xs text-slate-300">Scroll = zoom • {zoomPercent}% • {perspectiveLabel}</div>
        </div>
      </div>
    </div>
  );
}
