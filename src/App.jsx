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
  initial: "formatura_v8_initial",
  target: "formatura_v8_target",
  frames: "formatura_v8_frame_positions",
  steps: "formatura_v8_total_steps",
  unlock: "formatura_v8_unlock_steps",
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
      if (art[y][x] === "#") {
        pts.push({ x: x + offsetX, y: y + offsetY });
      }
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

  while (expanded.length < initialCount && allCells.length > 0) {
    expanded.push(allCells.shift());
  }

  return expanded;
};

const getFrameEntries = (frames, totalSteps) => {
  if (!frames) return [];

  return Object.entries(frames)
    .map(([step, pt]) => ({
      step: Number.parseInt(step, 10),
      pt: normalizeGridPoint(pt),
    }))
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

      if (manualPoint) {
        path.push(normalizeGridPoint(manualPoint));
      } else {
        path.push(previous);
      }
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
  return Object.values(framePositions || {}).reduce(
    (total, frames) => total + Object.keys(frames || {}).length,
    0
  );
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

        if (samePoint(aPrev, bNow) && samePoint(aNow, bPrev) && !samePoint(aNow, aPrev)) {
          directSwaps += 1;
        }
      }
    }
  }

  return { sameCellCollisions, directSwaps, longMoves };
};

export default function App() {
  const [mode, setMode] = useState("view");

  const [allowMoreThan50, setAllowMoreThan50] = useState(() => {
    return Boolean(safeJsonParse(STORAGE.unlock, false));
  });

  const [initialPoints, setInitialPoints] = useState(() => {
    return safeJsonParse(STORAGE.initial, generateInitialFormation());
  });

  const [targetPoints, setTargetPoints] = useState(() => {
    return safeJsonParse(STORAGE.target, generateTargetFormation());
  });

  const [framePositions, setFramePositions] = useState(() => {
    return safeJsonParse(STORAGE.frames, {});
  });

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

  const [viewBox, setViewBox] = useState({
    x: 0,
    y: 0,
    w: GRID_W,
    h: GRID_H,
  });

  const animationRef = useRef(null);
  const svgRef = useRef(null);

  useEffect(() => {
    localStorage.setItem(STORAGE.initial, JSON.stringify(initialPoints));
  }, [initialPoints]);

  useEffect(() => {
    localStorage.setItem(STORAGE.target, JSON.stringify(targetPoints));
  }, [targetPoints]);

  useEffect(() => {
    localStorage.setItem(STORAGE.frames, JSON.stringify(framePositions));
  }, [framePositions]);

  useEffect(() => {
    localStorage.setItem(STORAGE.steps, JSON.stringify(totalSteps));
  }, [totalSteps]);

  useEffect(() => {
    localStorage.setItem(STORAGE.unlock, JSON.stringify(allowMoreThan50));
  }, [allowMoreThan50]);

  const cadetsData = useMemo(() => {
    return buildManualPaths(initialPoints, framePositions, totalSteps, targetPoints);
  }, [initialPoints, framePositions, totalSteps, targetPoints]);

  const draftCadetsData = useMemo(() => {
    return buildManualPaths(initialPoints, draftFramePositions, totalSteps, targetPoints);
  }, [initialPoints, draftFramePositions, totalSteps, targetPoints]);

  const activeCadetsData = mode === "edit_path" ? draftCadetsData : cadetsData;
  const activeFramePositions = mode === "edit_path" ? draftFramePositions : framePositions;

  const pointsCountMismatch = initialPoints.length !== targetPoints.length;
  const manualFramesCount = countManualFrames(activeFramePositions);
  const notOnFinalTargetCount = activeCadetsData.filter((cadet) => !cadet.isOnFinalTarget).length;
  const validation = validateManualPlan(activeCadetsData, totalSteps);

  const selectedOne =
    selectedCadets.length === 1
      ? activeCadetsData.find((cadet) => cadet.id === selectedCadets[0])
      : null;

  const selectedOneManualSteps = selectedOne
    ? getFrameEntries(draftFramePositions[selectedOne.id], totalSteps).map(({ step }) => step)
    : [];

  const currentDisplayStep = mode === "edit_path" ? selectedStep : progress;
  const maxStepInput = allowMoreThan50 ? HARD_MAX_STEPS : DEFAULT_MAX_STEPS;
  const zoomPercent = Math.round((GRID_W / viewBox.w) * 100);

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

    if (e.touches && e.touches.length > 0) {
      pt.x = e.touches[0].clientX;
      pt.y = e.touches[0].clientY;
    } else {
      pt.x = e.clientX;
      pt.y = e.clientY;
    }

    return pt.matrixTransform(svg.getScreenCTM().inverse());
  };

  const zoomAtPoint = (mousePt, factor) => {
    setViewBox((prev) => {
      const minW = 8;
      let nextW = clamp(prev.w * factor, minW, GRID_W);
      let nextH = nextW * (GRID_H / GRID_W);

      if (nextH > GRID_H) {
        nextH = GRID_H;
        nextW = GRID_W;
      }

      const ratioW = nextW / prev.w;
      const ratioH = nextH / prev.h;

      const nextX = clamp(mousePt.x - (mousePt.x - prev.x) * ratioW, 0, GRID_W - nextW);
      const nextY = clamp(mousePt.y - (mousePt.y - prev.y) * ratioH, 0, GRID_H - nextH);

      return {
        x: nextX,
        y: nextY,
        w: nextW,
        h: nextH,
      };
    });
  };

  const handleWheel = (e) => {
    e.preventDefault();
    const pt = getSvgPt(e);
    const factor = e.deltaY > 0 ? 1.12 : 0.88;
    zoomAtPoint(pt, factor);
  };

  const resetZoom = () => {
    setViewBox({ x: 0, y: 0, w: GRID_W, h: GRID_H });
  };

  const handleStepCountChange = (value, nextAllow = allowMoreThan50) => {
    const next = normalizeStepCount(value, nextAllow);
    setTotalSteps(next);
    setProgress((prev) => clamp(Math.round(prev), 0, next));
    setSelectedStep((prev) => clamp(Math.round(prev), 1, next));
    setIsPlaying(false);
  };

  const toggleAllowMoreThan50 = (checked) => {
    setAllowMoreThan50(checked);

    if (!checked && totalSteps > DEFAULT_MAX_STEPS) {
      handleStepCountChange(DEFAULT_MAX_STEPS, false);
    }
  };

  const togglePlay = () => {
    if (progress >= totalSteps) setProgress(0);
    setIsPlaying((prev) => !prev);
  };

  const resetAnimation = () => {
    setIsPlaying(false);
    setProgress(0);
  };

  const addFramePosition = (prev, cadetId, step, pt) => {
    const normalizedStep = clamp(Math.round(step), 1, totalSteps);
    const next = { ...prev };

    next[cadetId] = {
      ...(next[cadetId] || {}),
      [normalizedStep]: normalizeGridPoint(pt),
    };

    return next;
  };

  const getSelectedData = () => {
    return selectedCadets
      .map((id) => activeCadetsData.find((cadet) => cadet.id === id))
      .filter(Boolean);
  };

  const evaluatePendingPositions = (positions) => {
    const seen = new Set();

    for (const { pt } of positions) {
      const key = pointKey(pt);
      if (seen.has(key)) {
        return { blocked: true, reason: "Dois selecionados ficariam no mesmo quadrado." };
      }
      seen.add(key);
    }

    for (const { id, pt } of positions) {
      const cadet = activeCadetsData.find((c) => c.id === id);
      if (!cadet) continue;

      const previousPt = getCadetPointAtStep(cadet, selectedStep - 1);

      if (manhattan(previousPt, pt) > 1) {
        return {
          blocked: true,
          reason: "Movimento maior que 1 quadrado. Use um passo intermediário.",
        };
      }
    }

    for (const cadet of activeCadetsData) {
      if (selectedCadets.includes(cadet.id)) continue;

      const unselectedNow = getCadetPointAtStep(cadet, selectedStep);
      const unselectedPrev = getCadetPointAtStep(cadet, selectedStep - 1);

      for (const { id, pt } of positions) {
        const selectedCadet = activeCadetsData.find((c) => c.id === id);
        if (!selectedCadet) continue;

        const selectedPrev = getCadetPointAtStep(selectedCadet, selectedStep - 1);

        if (samePoint(pt, unselectedNow)) {
          return {
            blocked: true,
            reason: "Este quadrado já está ocupado por outro cadete neste passo.",
          };
        }

        if (
          samePoint(selectedPrev, unselectedNow) &&
          samePoint(pt, unselectedPrev) &&
          !samePoint(selectedPrev, pt)
        ) {
          return {
            blocked: true,
            reason: "Troca direta de posição detectada. Isso causaria atravessamento.",
          };
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

        if (samePoint(a.pt, bPrev) && samePoint(b.pt, aPrev)) {
          return {
            blocked: true,
            reason: "Troca direta entre selecionados detectada.",
          };
        }
      }
    }

    return { blocked: false, reason: "Prévia pronta. Pressione Enter ou confirme." };
  };

  const startOrUpdatePendingMove = (positions) => {
    if (positions.length === 0) return;

    const normalized = positions.map(({ id, pt }) => ({
      id,
      pt: normalizeGridPoint(pt),
    }));

    const evaluation = evaluatePendingPositions(normalized);

    setPendingMove({
      positions: Object.fromEntries(normalized.map(({ id, pt }) => [id, pt])),
      blocked: evaluation.blocked,
      reason: evaluation.reason,
    });
  };

  const calculateShiftedPositions = (dx, dy) => {
    const selectedData = getSelectedData();

    return selectedData.map((cadet) => {
      const basePt = pendingMove?.positions?.[cadet.id] || getCadetPointAtStep(cadet, selectedStep);

      return {
        id: cadet.id,
        pt: {
          x: clamp(basePt.x + dx, 0, GRID_W - 1),
          y: clamp(basePt.y + dy, 0, GRID_H - 1),
        },
      };
    });
  };

  const nudgeSelection = (dx, dy) => {
    if (mode !== "edit_path" || selectedCadets.length === 0) return;
    startOrUpdatePendingMove(calculateShiftedPositions(dx, dy));
  };

  const confirmPendingMove = () => {
    if (!pendingMove || pendingMove.blocked) return;

    setDraftFramePositions((prev) => {
      let next = { ...prev };

      Object.entries(pendingMove.positions).forEach(([id, pt]) => {
        next = addFramePosition(next, id, selectedStep, pt);
      });

      return next;
    });

    setPendingMove(null);
  };

  const cancelPendingMove = () => setPendingMove(null);

  const moveSelectedCadetsTo = (x, y) => {
    if (selectedCadets.length === 0) return;

    const clicked = normalizeGridPoint({ x, y });
    const selectedData = getSelectedData();

    if (selectedData.length === 0) return;

    if (selectedData.length === 1) {
      startOrUpdatePendingMove([{ id: selectedData[0].id, pt: clicked }]);
      return;
    }

    const currentPositions = selectedData.map((cadet) => ({
      id: cadet.id,
      pt: pendingMove?.positions?.[cadet.id] || getCadetPointAtStep(cadet, selectedStep),
    }));

    const avgX = currentPositions.reduce((sum, item) => sum + item.pt.x, 0) / currentPositions.length;
    const avgY = currentPositions.reduce((sum, item) => sum + item.pt.y, 0) / currentPositions.length;

    const diffX = Math.round(clicked.x - avgX);
    const diffY = Math.round(clicked.y - avgY);

    startOrUpdatePendingMove(
      currentPositions.map(({ id, pt }) => ({
        id,
        pt: {
          x: clamp(pt.x + diffX, 0, GRID_W - 1),
          y: clamp(pt.y + diffY, 0, GRID_H - 1),
        },
      }))
    );
  };

  const renameSelectedCadet = (newLabel) => {
    if (!selectedOne) return;

    setInitialPoints((prev) =>
      prev.map((p) =>
        p.id === selectedOne.id
          ? { ...p, label: newLabel || p.id }
          : p
      )
    );
  }; useEffect(() => {
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
      } else if (e.key === "Delete" || e.key === "Backspace") {
        e.preventDefault();
        deleteSelectedStepFrame();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  });

  const handleGridClick = (x, y, event) => {
    const gridPt = normalizeGridPoint({ x, y });

    if (mode === "edit_initial") {
      setInitialPoints((prev) => {
        const exists = prev.find((p) => p.x === gridPt.x && p.y === gridPt.y);

        if (exists) {
          return prev.filter((p) => p.x !== gridPt.x || p.y !== gridPt.y);
        }

        const baseLabel = getRelativeBlockLabelFromGridPoint(gridPt);
        const id = makeUniqueCadetId(baseLabel, prev);

        return [
          ...prev,
          {
            id,
            label: baseLabel,
            x: gridPt.x,
            y: gridPt.y,
            originalX: gridPt.x - getInitialBlockOffset().x,
            originalY: gridPt.y - getInitialBlockOffset().y + 1,
          },
        ];
      });

      return;
    }

    if (mode === "edit_target") {
      setTargetPoints((prev) => {
        const exists = prev.find((p) => p.x === gridPt.x && p.y === gridPt.y);
        if (exists) return prev.filter((p) => p.x !== gridPt.x || p.y !== gridPt.y);
        return [...prev, { x: gridPt.x, y: gridPt.y }];
      });

      return;
    }

    if (mode === "edit_path") {
      const cadetAtPoint = activeCadetsData.find((cadet) =>
        samePoint(getCadetPointAtStep(cadet, selectedStep), gridPt)
      );

      if (cadetAtPoint) {
        setSelectedCadets((prev) => {
          if (event?.shiftKey) {
            return prev.includes(cadetAtPoint.id)
              ? prev.filter((id) => id !== cadetAtPoint.id)
              : [...prev, cadetAtPoint.id];
          }

          return [cadetAtPoint.id];
        });

        setPendingMove(null);
        return;
      }

      moveSelectedCadetsTo(gridPt.x, gridPt.y);
    }
  };

  const handlePointerDown = (e) => {
    if (mode !== "edit_path") return;

    const pt = getSvgPt(e);

    setSelectionBox({
      startX: pt.x,
      startY: pt.y,
      currentX: pt.x,
      currentY: pt.y,
      isDragging: false,
    });
  };

  const handlePointerMove = (e) => {
    if (!selectionBox || mode !== "edit_path") return;

    const pt = getSvgPt(e);
    const dx = Math.abs(pt.x - selectionBox.startX);
    const dy = Math.abs(pt.y - selectionBox.startY);

    if (dx > 0.5 || dy > 0.5) {
      setSelectionBox((prev) => ({
        ...prev,
        currentX: pt.x,
        currentY: pt.y,
        isDragging: true,
      }));
    }
  };

  const handlePointerUp = (e) => {
    if (mode !== "edit_path" || !selectionBox) return;

    const pt = getSvgPt(e);

    if (!selectionBox.isDragging) {
      handleGridClick(Math.floor(selectionBox.startX), Math.floor(selectionBox.startY), e);
      setSelectionBox(null);
      return;
    }

    const minX = Math.min(selectionBox.startX, pt.x);
    const maxX = Math.max(selectionBox.startX, pt.x);
    const minY = Math.min(selectionBox.startY, pt.y);
    const maxY = Math.max(selectionBox.startY, pt.y);

    const selectedIds = activeCadetsData
      .filter((cadet) => {
        const p = getCadetPointAtStep(cadet, selectedStep);
        return p.x >= minX && p.x <= maxX && p.y >= minY && p.y <= maxY;
      })
      .map((cadet) => cadet.id);

    setSelectedCadets((prev) => {
      if (e.shiftKey) return [...new Set([...prev, ...selectedIds])];
      return selectedIds;
    });

    setPendingMove(null);
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

    setDraftFramePositions((prev) => {
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

    setDraftFramePositions((prev) => {
      const next = { ...prev };
      selectedCadets.forEach((id) => delete next[id]);
      return next;
    });

    setPendingMove(null);
  };

  const clearAllRoutes = () => {
    if (window.confirm("Deseja apagar todas as posições/quadro-a-quadro editadas?")) {
      setDraftFramePositions({});
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
      setViewBox({ x: 0, y: 0, w: GRID_W, h: GRID_H });
      setMode("view");
      setIsPlaying(false);
    }
  };

  const exportCSV = () => {
    let csvContent = "data:text/csv;charset=utf-8,";
    let header = "Cadete";

    for (let i = 0; i <= totalSteps; i++) header += `,Passo ${i}`;
    csvContent += `${header}\n`;

    cadetsData.forEach((cadet) => {
      let row = cadet.label || cadet.id;

      for (let i = 0; i <= totalSteps; i++) {
        const pt = getCadetPointAtStep(cadet, i);
        row += `,"(${formatCoord(pt.x)}, ${formatCoord(pt.y)})"`;
      }

      csvContent += `${row}\n`;
    });

    const link = document.createElement("a");
    link.setAttribute("href", encodeURI(csvContent));
    link.setAttribute("download", "Roteiro_Formatura.csv");
    document.body.appendChild(link);
    link.click();
    link.remove();
  };

  const exportJSON = () => {
    const data = {
      initialPoints,
      targetPoints,
      framePositions,
      totalSteps,
      allowMoreThan50,
      version: 8,
      mode: "manual",
    };

    const encoded = `data:text/json;charset=utf-8,${encodeURIComponent(JSON.stringify(data, null, 2))}`;

    const link = document.createElement("a");
    link.setAttribute("href", encoded);
    link.setAttribute("download", "Projeto_Formatura.json");
    document.body.appendChild(link);
    link.click();
    link.remove();
  };

  return (
    <div className="min-h-screen bg-slate-900 text-slate-100 flex flex-col md:flex-row font-sans selection:bg-blue-500/30">
      <div className="w-full md:w-[430px] bg-slate-800 p-6 flex flex-col border-r border-slate-700 shadow-xl overflow-y-auto shrink-0 z-10">
        <h1 className="text-2xl font-bold mb-1 text-white tracking-wide">Formatura Militar</h1>
        <p className="text-sm text-slate-400 mb-6">
          Coreografia manual quadro-a-quadro com anticolisão
        </p>

        <div className="flex flex-wrap bg-slate-900 rounded-lg p-1 mb-6 gap-1">
          <button
            onClick={() => {
              setMode("view");
              setIsPlaying(false);
              setSelectedCadets([]);
              setPendingMove(null);
            }}
            className={`flex-1 py-2 text-xs font-semibold rounded flex justify-center items-center gap-1.5 ${mode === "view" ? "bg-blue-600 text-white shadow" : "text-slate-400 hover:text-white"
              }`}
          >
            <Eye size={14} /> Animação
          </button>

          <button
            onClick={() => {
              setMode("edit_initial");
              resetAnimation();
              setSelectedCadets([]);
              setPendingMove(null);
            }}
            className={`flex-1 py-2 text-xs font-semibold rounded flex justify-center items-center gap-1.5 ${mode === "edit_initial" ? "bg-slate-700 text-white shadow" : "text-slate-400 hover:text-white"
              }`}
          >
            <Edit3 size={14} /> Início
          </button>

          <button
            onClick={() => {
              setMode("edit_target");
              resetAnimation();
              setSelectedCadets([]);
              setPendingMove(null);
            }}
            className={`flex-1 py-2 text-xs font-semibold rounded flex justify-center items-center gap-1.5 ${mode === "edit_target" ? "bg-slate-700 text-white shadow" : "text-slate-400 hover:text-white"
              }`}
          >
            <Edit3 size={14} /> Alvo
          </button>

          <button
            onClick={enterDraftMode}
            className={`flex-1 py-2 text-xs font-semibold rounded flex justify-center items-center gap-1.5 ${mode === "edit_path" ? "bg-amber-600 text-white shadow" : "text-slate-400 hover:text-white"
              }`}
          >
            <Route size={14} /> Coreografia
          </button>
        </div>

        <div className="mb-6 p-4 rounded-lg bg-slate-900 border border-slate-700 space-y-3">
          <div className="flex justify-between items-center">
            <span className="text-sm text-slate-400">Total de Cadetes</span>
            <span className="font-bold text-lg">{initialPoints.length}</span>
          </div>

          <div className="flex justify-between items-center">
            <span className="text-sm text-slate-400">Pontos no Gládio</span>
            <span className={`font-bold text-lg ${pointsCountMismatch ? "text-red-400" : "text-green-400"}`}>
              {targetPoints.length}
            </span>
          </div>

          <div className="border-t border-slate-700 pt-3">
            <label className="text-sm text-slate-300 flex justify-between mb-2">
              Quantidade de passos
              <span className="font-mono text-emerald-400">
                {totalSteps} / {maxStepInput}
              </span>
            </label>

            <div className="flex gap-2">
              <input
                type="range"
                min={MIN_STEPS}
                max={maxStepInput}
                step="1"
                value={totalSteps}
                onChange={(e) => handleStepCountChange(e.target.value)}
                className="w-full h-2 bg-slate-700 rounded-lg appearance-none cursor-pointer accent-emerald-500"
              />

              <input
                type="number"
                min={MIN_STEPS}
                max={maxStepInput}
                value={totalSteps}
                onChange={(e) => handleStepCountChange(e.target.value)}
                className="w-24 bg-slate-800 border border-slate-600 rounded px-2 py-1 text-center font-mono text-sm"
              />
            </div>

            <label className="mt-3 flex items-center gap-2 text-xs text-slate-300">
              <input
                type="checkbox"
                checked={allowMoreThan50}
                onChange={(e) => toggleAllowMoreThan50(e.target.checked)}
                className="accent-emerald-500"
              />
              Permitir mais de 50 passos manualmente
            </label>
          </div>

          <div className="flex justify-between items-center border-t border-slate-700 pt-3">
            <span className="text-sm text-slate-400">Quadros editados</span>
            <span className="font-bold text-lg text-amber-400">{manualFramesCount}</span>
          </div>

          <div className="flex justify-between items-center">
            <span className="text-sm text-slate-400">Zoom</span>
            <span className="font-bold text-lg text-blue-400">{zoomPercent}%</span>
          </div>

          <button
            onClick={resetZoom}
            className="w-full py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded text-sm border border-slate-700 flex items-center justify-center gap-2"
          >
            <ZoomIn size={15} /> Resetar zoom
          </button>

          {pointsCountMismatch && (
            <div className="text-xs bg-red-950/40 border border-red-900/60 rounded p-2 text-red-200 flex gap-2">
              <Info size={14} className="shrink-0 mt-0.5" />
              <span>O número de cadetes e pontos do gládio está diferente.</span>
            </div>
          )}

          {notOnFinalTargetCount > 0 && (
            <div className="text-xs bg-amber-950/40 border border-amber-900/60 rounded p-2 text-amber-200 flex gap-2">
              <Info size={14} className="shrink-0 mt-0.5" />
              <span>
                {notOnFinalTargetCount} cadete(s) ainda não estão sobre pontos do gládio no último passo.
              </span>
            </div>
          )}

          {(validation.sameCellCollisions > 0 || validation.directSwaps > 0 || validation.longMoves > 0) && (
            <div className="text-xs bg-red-950/40 border border-red-900/60 rounded p-2 text-red-200 flex gap-2">
              <Info size={14} className="shrink-0 mt-0.5" />
              <span>
                Colisões: {validation.sameCellCollisions}, atravessamentos: {validation.directSwaps}, saltos longos: {validation.longMoves}.
              </span>
            </div>
          )}
        </div>

        {mode === "view" && (
          <div className="space-y-6">
            <div className="space-y-2">
              <div className="flex justify-between text-sm">
                <span className="text-slate-300 font-medium">Tempo Mestre</span>
                <span className="text-blue-400 font-mono font-bold">
                  Passo {progress} / {totalSteps}
                </span>
              </div>

              <input
                type="range"
                min="0"
                max={totalSteps}
                step="1"
                value={progress}
                onChange={(e) => {
                  setProgress(Number.parseInt(e.target.value, 10));
                  setIsPlaying(false);
                }}
                className="w-full h-2 bg-slate-700 rounded-lg appearance-none cursor-pointer accent-blue-500"
              />
            </div>

            <div className="flex gap-2">
              <button
                onClick={togglePlay}
                className="flex-1 bg-blue-600 hover:bg-blue-500 text-white py-3 rounded-lg flex items-center justify-center gap-2 font-bold transition-colors"
              >
                {isPlaying ? <Pause size={18} /> : <Play size={18} />}
                {isPlaying ? "Pausar" : progress >= totalSteps ? "Reiniciar" : "Marcha"}
              </button>

              <button
                onClick={resetAnimation}
                className="px-4 bg-slate-700 hover:bg-slate-600 text-white rounded-lg flex items-center justify-center transition-colors"
              >
                <RotateCcw size={18} />
              </button>
            </div>

            <div className="space-y-2">
              <label className="text-sm text-slate-300 flex justify-between">
                Velocidade <span className="font-mono">{animationSpeed.toFixed(1)} passos/s</span>
              </label>

              <input
                type="range"
                min="0.5"
                max="5"
                step="0.5"
                value={animationSpeed}
                onChange={(e) => setAnimationSpeed(Number.parseFloat(e.target.value))}
                className="w-full h-2 bg-slate-700 rounded-lg appearance-none cursor-pointer accent-slate-400"
              />
            </div>

            <div className="pt-6 border-t border-slate-700">
              <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3">
                Exportar Planejamento
              </h3>

              <div className="flex flex-col gap-2">
                <button
                  onClick={exportCSV}
                  className="w-full py-2 bg-green-900/30 hover:bg-green-800/50 text-green-400 text-sm rounded flex items-center justify-center gap-2 border border-green-800/50 transition-colors"
                >
                  <FileSpreadsheet size={16} /> Planilha Passo-a-Passo
                </button>

                <button
                  onClick={exportJSON}
                  className="w-full py-2 bg-slate-700/50 hover:bg-slate-700 text-slate-300 text-sm rounded flex items-center justify-center gap-2 border border-slate-600 transition-colors"
                >
                  <FileJson size={16} /> Backup do Projeto
                </button>
              </div>
            </div>
          </div>
        )}

        {mode === "edit_path" && (
          <div className="space-y-4 flex flex-col h-full">
            <div className="bg-amber-900/20 border border-amber-800/50 rounded-lg p-4 text-sm text-amber-200">
              <h3 className="font-bold flex items-center gap-2 mb-2 text-amber-500">
                <Route size={16} /> Coreografia Manual
              </h3>

              <ul className="opacity-90 text-xs list-disc pl-4 space-y-1">
                <li>Clique em um cadete para selecionar indivíduo.</li>
                <li>Use Shift + clique para somar/remover indivíduos.</li>
                <li>Arraste para selecionar grupos.</li>
                <li>Use as setas para mover 1 quadrado e Enter para confirmar.</li>
                <li>Use o scroll do mouse sobre o campo para dar zoom.</li>
              </ul>
            </div>

            <div className="bg-slate-900 border border-slate-700 rounded-lg p-4 space-y-3">
              <label className="text-sm text-slate-300 flex justify-between">
                Passo selecionado
                <span className="font-mono text-amber-400">
                  {selectedStep} / {totalSteps}
                </span>
              </label>

              <input
                type="range"
                min="1"
                max={totalSteps}
                step="1"
                value={selectedStep}
                onChange={(e) => {
                  setSelectedStep(clamp(Number.parseInt(e.target.value, 10), 1, totalSteps));
                  setPendingMove(null);
                }}
                className="w-full h-2 bg-slate-700 rounded-lg appearance-none cursor-pointer accent-amber-500"
              />

              <div className="flex gap-2">
                <button
                  onClick={() => {
                    setSelectedStep((prev) => clamp(prev - 1, 1, totalSteps));
                    setPendingMove(null);
                  }}
                  className="flex-1 py-2 bg-slate-800 hover:bg-slate-700 rounded text-sm border border-slate-700"
                >
                  Passo -
                </button>

                <input
                  type="number"
                  min="1"
                  max={totalSteps}
                  value={selectedStep}
                  onChange={(e) => {
                    setSelectedStep(clamp(Number.parseInt(e.target.value || "1", 10), 1, totalSteps));
                    setPendingMove(null);
                  }}
                  className="w-20 bg-slate-800 border border-slate-600 rounded px-2 py-1 text-center font-mono text-sm"
                />

                <button
                  onClick={() => {
                    setSelectedStep((prev) => clamp(prev + 1, 1, totalSteps));
                    setPendingMove(null);
                  }}
                  className="flex-1 py-2 bg-slate-800 hover:bg-slate-700 rounded text-sm border border-slate-700"
                >
                  Passo +
                </button>
              </div>
            </div>

            {selectedCadets.length > 0 && (
              <div className="bg-slate-900 border border-slate-700 rounded-lg p-4">
                <div className="flex items-center gap-2 mb-3">
                  <div className="w-3 h-3 rounded-full bg-amber-400" />
                  <span className="font-bold">Selecionados: {selectedCadets.length}</span>
                </div>

                {selectedOne && (
                  <div className="mb-3">
                    <label className="text-xs text-slate-400 block mb-1">
                      Nome/coord. do quadrado selecionado
                    </label>
                    <input
                      value={selectedOne.label || selectedOne.id}
                      onChange={(e) => renameSelectedCadet(e.target.value)}
                      className="w-full bg-slate-800 border border-slate-600 rounded px-3 py-2 text-sm text-white"
                    />
                  </div>
                )}

                {pendingMove && (
                  <div
                    className={`mb-3 p-2 rounded text-xs border ${pendingMove.blocked
                        ? "bg-red-950/40 border-red-900/60 text-red-200"
                        : "bg-emerald-950/40 border-emerald-900/60 text-emerald-200"
                      }`}
                  >
                    {pendingMove.reason}
                  </div>
                )}

                <div className="grid grid-cols-1 gap-2">
                  <button
                    onClick={confirmPendingMove}
                    disabled={!pendingMove || pendingMove.blocked}
                    className="w-full py-2 bg-emerald-700 hover:bg-emerald-600 disabled:bg-slate-700 disabled:text-slate-500 text-white rounded-md flex items-center justify-center gap-2 transition-colors border border-emerald-800/50"
                  >
                    <CheckSquare size={16} /> Confirmar local
                  </button>

                  <button
                    onClick={cancelPendingMove}
                    disabled={!pendingMove}
                    className="w-full py-2 bg-slate-700 hover:bg-slate-600 disabled:bg-slate-800 disabled:text-slate-600 text-white rounded-md flex items-center justify-center gap-2 transition-colors"
                  >
                    Cancelar prévia
                  </button>

                  <button
                    onClick={deleteSelectedStepFrame}
                    className="w-full py-2 bg-red-950/50 hover:bg-red-900/70 text-red-200 rounded-md flex items-center justify-center gap-2 transition-colors border border-red-900/60"
                  >
                    <Trash2 size={16} /> Apagar posição do passo {selectedStep}
                  </button>

                  <button
                    onClick={clearSelectedConfig}
                    className="w-full py-2 bg-red-900/30 hover:bg-red-800/50 text-red-200 rounded-md flex items-center justify-center gap-2 transition-colors border border-red-800/50"
                  >
                    <Trash2 size={16} /> Apagar rota completa dos selecionados
                  </button>
                </div>

                {selectedOne && selectedOneManualSteps.length > 0 && (
                  <div className="mt-4 border-t border-slate-700 pt-3">
                    <p className="text-xs text-slate-400 mb-2">
                      Passos editados de {selectedOne.label || selectedOne.id}:
                    </p>

                    <div className="flex flex-wrap gap-1">
                      {selectedOneManualSteps.map((step) => (
                        <button
                          key={step}
                          onClick={() => {
                            setSelectedStep(step);
                            setPendingMove(null);
                          }}
                          className={`px-2 py-1 rounded text-xs border ${step === selectedStep
                              ? "bg-amber-500 text-slate-950 border-amber-300"
                              : "bg-slate-800 text-slate-300 border-slate-700 hover:bg-slate-700"
                            }`}
                        >
                          {step}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}

            <div className="bg-slate-900 border border-slate-700 rounded-lg p-4 text-xs text-slate-300 flex items-start gap-2">
              <Keyboard size={16} className="text-slate-500 shrink-0" />
              <span>Atalhos: setas movem, Enter confirma, Esc cancela, Delete apaga o passo editado.</span>
            </div>

            <div className="grid grid-cols-1 gap-2">
              <button
                onClick={clearAllRoutes}
                className="w-full py-2 bg-slate-900 hover:bg-slate-700 text-slate-300 text-sm rounded flex items-center justify-center gap-2 border border-slate-700 transition-colors"
              >
                <Trash2 size={16} /> Apagar todas as posições editadas
              </button>

              <button
                onClick={cancelDraft}
                className="w-full py-2 bg-slate-700 hover:bg-slate-600 text-white text-sm rounded flex items-center justify-center gap-2 transition-colors"
              >
                Cancelar edição
              </button>

              <button
                onClick={applyDraft}
                className="w-full py-3 bg-emerald-600 hover:bg-emerald-500 text-white font-bold rounded-lg flex items-center justify-center gap-2 transition-colors shadow-lg shadow-emerald-900/50"
              >
                <CheckSquare size={18} /> Salvar Coreografia
              </button>
            </div>
          </div>
        )}

        {(mode === "edit_initial" || mode === "edit_target") && (
          <div className="space-y-3">
            <div className="bg-slate-900 border border-slate-700 rounded-lg p-4 text-sm text-slate-300">
              {mode === "edit_initial"
                ? "Clique nos quadrados para editar a posição inicial. O nome novo será relativo ao bloco 9x19."
                : "Clique nos quadrados para editar o gládio final."}
            </div>

            {mode === "edit_initial" && (
              <button
                onClick={resetInitialBlock}
                className="w-full py-2 bg-slate-700 hover:bg-slate-600 text-white rounded-md text-sm"
              >
                Restaurar bloco 9x19
              </button>
            )}

            {mode === "edit_target" && (
              <button
                onClick={resetTargetGladio}
                className="w-full py-2 bg-slate-700 hover:bg-slate-600 text-white rounded-md text-sm"
              >
                Restaurar gládio
              </button>
            )}

            <button
              onClick={resetToDefault}
              className="w-full py-2 text-xs font-medium bg-red-950/30 hover:bg-red-900/50 text-red-400 rounded-md transition-colors"
            >
              Apagar Tudo e Restaurar Original
            </button>
          </div>
        )}

        {(mode === "view" || mode === "edit_path") && selectedCadets.length === 0 && (
          <div className="mt-auto pt-6">
            <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3">
              Inspeção Unitária
            </h3>

            <div className="bg-slate-900 border border-slate-700 rounded-lg p-4 min-h-32 flex flex-col justify-center">
              {hoveredCadet ? (
                <>
                  <div className="flex items-center gap-2 mb-2">
                    <div className="w-3 h-3 rounded-full bg-blue-400" />
                    <span className="font-bold text-lg">{hoveredCadet.label || hoveredCadet.id}</span>
                  </div>

                  <div className="text-sm text-slate-400 grid grid-cols-2 gap-2 mt-2">
                    <div>
                      <span className="block text-xs text-slate-500">Início</span>
                      ({hoveredCadet.startX}, {hoveredCadet.startY})
                    </div>

                    <div>
                      <span className="block text-xs text-slate-500">Neste passo</span>
                      (
                      {formatCoord(getCadetPointAtStep(hoveredCadet, currentDisplayStep).x)},{" "}
                      {formatCoord(getCadetPointAtStep(hoveredCadet, currentDisplayStep).y)}
                      )
                    </div>
                  </div>
                </>
              ) : (
                <div className="text-center text-slate-500 text-sm flex flex-col items-center gap-2">
                  <Info size={20} className="text-slate-600 opacity-50" />
                  <span className="opacity-70">Passe o mouse sobre um militar.</span>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      <div className="flex-1 bg-[#15171e] p-2 md:p-6 flex items-center justify-center overflow-hidden relative">
        <div
          className="w-full max-w-7xl relative border border-slate-800 rounded-xl shadow-2xl bg-[#252830] overflow-hidden"
          style={{ aspectRatio: `${GRID_W} / ${GRID_H}` }}
        >
          <div
            className="absolute inset-0 opacity-10 pointer-events-none"
            style={{
              backgroundImage:
                "linear-gradient(#fff 1px, transparent 1px), linear-gradient(90deg, #fff 1px, transparent 1px)",
              backgroundSize: `${100 / GRID_W}% ${100 / GRID_H}%`,
            }}
          />

          <svg
            ref={svgRef}
            viewBox={`${viewBox.x} ${viewBox.y} ${viewBox.w} ${viewBox.h}`}
            className="w-full h-full touch-none"
            onWheel={handleWheel}
            onMouseLeave={() => {
              setHoveredCadet(null);
              setSelectionBox(null);
            }}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
          >
            {(mode === "edit_target" || mode === "edit_path" || mode === "view") && (
              <g pointerEvents="none" opacity={mode === "view" ? 0.28 : 0.55}>
                {targetPoints.map((p, idx) => (
                  <rect
                    key={`target-${idx}`}
                    x={p.x}
                    y={p.y}
                    width={1}
                    height={1}
                    fill="#fbbf24"
                    stroke="#92400e"
                    strokeWidth="0.04"
                    rx={0.08}
                  />
                ))}
              </g>
            )}

            {mode !== "view" && (
              <g className={mode === "edit_path" ? "cursor-crosshair" : "cursor-pointer"}>
                {Array.from({ length: GRID_H }).map((_, y) =>
                  Array.from({ length: GRID_W }).map((_, x) => {
                    let fill = "transparent";

                    if (mode === "edit_initial" && initialPoints.find((p) => p.x === x && p.y === y)) {
                      fill = "#94a3b8";
                    }

                    if (mode === "edit_target" && targetPoints.find((p) => p.x === x && p.y === y)) {
                      fill = "#fbbf24";
                    }

                    return (
                      <rect
                        key={`${x}-${y}`}
                        x={x}
                        y={y}
                        width={1}
                        height={1}
                        fill={fill}
                        stroke="#4b5563"
                        strokeWidth="0.045"
                        onClick={(e) => {
                          e.stopPropagation();
                          if (mode !== "edit_path") handleGridClick(x, y, e);
                        }}
                        className={mode !== "edit_path" ? "hover:fill-slate-600" : ""}
                      />
                    );
                  })
                )}
              </g>
            )}

            {mode === "edit_path" &&
              selectedCadets.map((selId) => {
                const cadet = activeCadetsData.find((c) => c.id === selId);
                if (!cadet) return null;

                const pathString = cadet.path
                  .map((p, i) => `${i === 0 ? "M" : "L"} ${p.x + 0.5},${p.y + 0.5}`)
                  .join(" ");

                const manualFrames = getFrameEntries(draftFramePositions[selId], totalSteps);
                const currentPt = pendingMove?.positions?.[selId] || getCadetPointAtStep(cadet, selectedStep);

                return (
                  <g key={`route-${selId}`} pointerEvents="none">
                    <path
                      d={pathString}
                      fill="none"
                      stroke="#f59e0b"
                      strokeWidth="0.12"
                      strokeDasharray="0.22 0.22"
                      className="opacity-80"
                    />

                    {manualFrames.map(({ step, pt }) => (
                      <g key={`${selId}-${step}`}>
                        <circle
                          cx={pt.x + 0.5}
                          cy={pt.y + 0.5}
                          r={step === selectedStep ? 0.32 : 0.22}
                          fill={step === selectedStep ? "#fde68a" : "#b45309"}
                          stroke="#f59e0b"
                          strokeWidth="0.08"
                        />

                        <text
                          x={pt.x + 0.5}
                          y={pt.y + 0.53}
                          fontSize="0.24"
                          textAnchor="middle"
                          dominantBaseline="middle"
                          fill="#111827"
                          fontWeight="900"
                        >
                          {step}
                        </text>
                      </g>
                    ))}

                    <rect
                      x={currentPt.x + 0.04}
                      y={currentPt.y + 0.04}
                      width={0.92}
                      height={0.92}
                      fill="none"
                      stroke={pendingMove?.blocked ? "#ef4444" : "#38bdf8"}
                      strokeWidth="0.13"
                      rx={0.16}
                    />
                  </g>
                );
              })}

            {(mode === "view" || mode === "edit_path") &&
              activeCadetsData.map((cadet) => {
                const stepToShow = mode === "edit_path" ? selectedStep : progress;
                const pendingPt = pendingMove?.positions?.[cadet.id];
                const pt = pendingPt || getCadetPointAtStep(cadet, stepToShow);

                const isHovered = hoveredCadet?.id === cadet.id;
                const isSelected = selectedCadets.includes(cadet.id);
                const isPending = Boolean(pendingPt);

                let fillColor = "#f8fafc";
                let strokeColor = "#0f172a";
                let textColor = "#0f172a";

                if (isPending && pendingMove?.blocked) {
                  fillColor = "#ef4444";
                  strokeColor = "#ffffff";
                  textColor = "#ffffff";
                } else if (isPending) {
                  fillColor = "#34d399";
                  strokeColor = "#ffffff";
                  textColor = "#052e16";
                } else if (isSelected) {
                  fillColor = "#fbbf24";
                  strokeColor = "#ffffff";
                  textColor = "#111827";
                } else if (isHovered) {
                  fillColor = "#60a5fa";
                  strokeColor = "#ffffff";
                  textColor = "#ffffff";
                }

                return (
                  <g
                    key={cadet.id}
                    transform={`translate(${pt.x}, ${pt.y})`}
                    onMouseEnter={() => setHoveredCadet(cadet)}
                    onClick={(e) => {
                      if (mode === "edit_path") {
                        e.stopPropagation();
                        handleGridClick(pt.x, pt.y, e);
                      }
                    }}
                    style={{
                      cursor: mode === "edit_path" ? "pointer" : "default",
                      transition: isPlaying ? `transform ${Math.min(0.35, 0.9 / animationSpeed)}s linear` : "none",
                    }}
                  >
                    <rect
                      x={0.025}
                      y={0.025}
                      width={0.95}
                      height={0.95}
                      fill={fillColor}
                      stroke={strokeColor}
                      strokeWidth={isSelected || isHovered || isPending ? "0.095" : "0.05"}
                      rx={0.16}
                    />

                    <text
                      x={0.5}
                      y={0.52}
                      fontSize="0.34"
                      textAnchor="middle"
                      dominantBaseline="middle"
                      fill={textColor}
                      fontWeight="900"
                      stroke={textColor === "#ffffff" ? "#0f172a" : "rgba(255,255,255,0.55)"}
                      strokeWidth={textColor === "#ffffff" ? "0.025" : "0.012"}
                      style={{
                        userSelect: "none",
                        paintOrder: "stroke",
                        pointerEvents: "none",
                      }}
                    >
                      {cadet.label || cadet.id}
                    </text>

                    <ellipse
                      cx={0.5}
                      cy={0.91}
                      rx={0.32}
                      ry={0.08}
                      fill="rgba(0,0,0,0.3)"
                      pointerEvents="none"
                    />
                  </g>
                );
              })}

            {selectionBox && selectionBox.isDragging && (
              <rect
                x={Math.min(selectionBox.startX, selectionBox.currentX)}
                y={Math.min(selectionBox.startY, selectionBox.currentY)}
                width={Math.abs(selectionBox.currentX - selectionBox.startX)}
                height={Math.abs(selectionBox.currentY - selectionBox.startY)}
                fill="rgba(96, 165, 250, 0.2)"
                stroke="#60a5fa"
                strokeWidth="0.1"
                pointerEvents="none"
              />
            )}
          </svg>

          <div className="absolute right-3 bottom-3 bg-slate-950/80 border border-slate-700 rounded-lg px-3 py-2 text-xs text-slate-300">
            Scroll = zoom • {zoomPercent}%
          </div>
        </div>
      </div>
    </div>
  );
}