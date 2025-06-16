// Mowing animation logic ported from Mowing.py

const WIDTH = 600;
const HEIGHT = 600;
const TILE_SIZE = 20;
const COLS = WIDTH / TILE_SIZE;
const ROWS = HEIGHT / TILE_SIZE;
const FPS = 10;
const TARGET_TOTAL_TIME_SEC = 60; // Lower target for responsiveness
const MAX_SUBGRID_SOLVE_TIME_SEC = 10; // Lower max per subgrid
const MAX_CALIBRATION_T = 60; // Don't try huge subgrids

// Generate a palette of distinct colors for subgrids
function generateSubgridColors(n) {
    const colors = [];
    for (let i = 0; i < n; i++) {
        // Use HSL for visually distinct colors
        const hue = Math.floor((360 * i) / n);
        colors.push(`hsl(${hue}, 70%, 70%)`);
    }
    return colors;
}
let subgridColors = [];
let grassMask, mowed, subgrids, subgridTours, fullPath, pathIndex, animationId;
let startTime, timerInterval;
let minGrid, maxGrid;
let estimatedTotalSolveTime = 0;
let estimatedTimeLeft = 0;
let avgSubgridSolveTime = 0;

// Override highlightSubgrids to color all subgrids differently
function highlightSubgrids(ctx) {
    if (!subgrids || !subgridColors.length) return;
    for (let i = 0; i < subgrids.length; i++) {
        const [r0, r1, c0, c1] = subgrids[i];
        ctx.fillStyle = subgridColors[i];
        for (let y = r0; y <= r1; y++)
            for (let x = c0; x <= c1; x++)
                ctx.fillRect(x * TILE_SIZE, y * TILE_SIZE, TILE_SIZE, TILE_SIZE);
    }
    // Optionally, overlay min/max highlights
    ctx.fillStyle = HIGHLIGHT_MIN;
    for (let y = minGrid[0]; y <= minGrid[1]; y++)
        for (let x = minGrid[2]; x <= minGrid[3]; x++)
            ctx.fillRect(x * TILE_SIZE, y * TILE_SIZE, TILE_SIZE, TILE_SIZE);
    ctx.fillStyle = HIGHLIGHT_MAX;
    for (let y = maxGrid[0]; y <= maxGrid[1]; y++)
        for (let x = maxGrid[2]; x <= maxGrid[3]; x++)
            ctx.fillRect(x * TILE_SIZE, y * TILE_SIZE, TILE_SIZE, TILE_SIZE);
}

// Patch setupAndStart to generate subgridColors after subgrids are created
const originalSetupAndStart = setupAndStart;
setupAndStart = function() {
    if (!document.getElementById('timer')) {
        const te = document.createElement('div'); te.id='timer'; te.style.font='16px monospace';
        te.style.margin='8px'; document.body.insertBefore(te, document.body.firstChild);
    }
    // Show calibration message
    document.getElementById('timer').textContent = "Calibrating...";
    setTimeout(() => {
        startTimer();
        grassMask = createGrassMask();
        calibrateThreshold();
        mowed = Array.from({length: ROWS}, () => Array(COLS).fill(0));
        subgrids = [];
        subdivide(0, ROWS-1, 0, COLS-1, grassMask, subgrids);
        subgridColors = generateSubgridColors(subgrids.length);
        findMinMax(subgrids);
        subgridTours = [];
        let totalSolveTime = 0;
        for (let g of subgrids) {
            let subStart = Date.now();
            const tour = solveSubgridTSP(...g, grassMask);
            let subTime = (Date.now() - subStart) / 1000;
            totalSolveTime += subTime;
            if (tour.length) subgridTours.push(tour);
        }
        estimatedTotalSolveTime = totalSolveTime;
        avgSubgridSolveTime = subgrids.length ? totalSolveTime / subgrids.length : 0;
        fullPath = buildFullPath(subgridTours);
        pathIndex=0; if(animationId) clearTimeout(animationId);
        setTimeout(animate, 500); // Shorter load time for UI
    }, 50); // Let UI update before heavy work
};
let MAX_GRASS_PER_SUBGRID = 25;  // will be calibrated

// Colors
const GREEN = "#228B22";
const BROWN = "#8B4513";
const DIRT_GRAY = "#A9A9A9";
const WHITE = "#FFFFFF";
const MOWER_COLOR = "#FF0000";
const HIGHLIGHT_MIN = "rgba(0, 0, 255, 0.2)";   // blue overlay for smallest
const HIGHLIGHT_MAX = "rgba(255, 0, 0, 0.2)"; // red overlay for largest

function randomInt(a, b) { return Math.floor(Math.random() * (b - a + 1)) + a; }
function randomFloat(a, b) { return Math.random() * (b - a) + a; }

function createGrassMask() {
    let mask = Array.from({length: ROWS}, () => Array(COLS).fill(1));
    let numCircles = randomInt(3, 5);
    for (let i = 0; i < numCircles; ++i) {
        let cx = randomFloat(0, COLS), cy = randomFloat(0, ROWS), radius = randomFloat(2, 5);
        for (let y = 0; y < ROWS; ++y) for (let x = 0; x < COLS; ++x) {
            if (Math.hypot(x - cx, y - cy) < radius) mask[y][x] = 0;
        }
    }
    let numRects = randomInt(2, 4);
    for (let i = 0; i < numRects; ++i) {
        let w = randomInt(2, 5), h = randomInt(2, 5);
        let sx = randomInt(0, COLS - w), sy = randomInt(0, ROWS - h);
        for (let y = sy; y < sy + h; ++y) for (let x = sx; x < sx + w; ++x) mask[y][x] = 0;
    }
    return mask;
}

function countGrass(r0, r1, c0, c1, mask) {
    let cnt = 0;
    for (let r = r0; r <= r1; ++r) for (let c = c0; c <= c1; ++c) if (mask[r][c] === 1) cnt++;
    return cnt;
}

function subdivide(r0, r1, c0, c1, mask, subgrids) {
    let cnt = countGrass(r0, r1, c0, c1, mask);
    if (cnt <= MAX_GRASS_PER_SUBGRID) { subgrids.push([r0, r1, c0, c1]); return; }
    let dr = r1 - r0 + 1, dc = c1 - c0 + 1;
    if (dr >= dc) {
        let mid = Math.floor((r0 + r1) / 2);
        subdivide(r0, mid, c0, c1, mask, subgrids);
        subdivide(mid + 1, r1, c0, c1, mask, subgrids);
    } else {
        let mid = Math.floor((c0 + c1) / 2);
        subdivide(r0, r1, c0, mid, mask, subgrids);
        subdivide(r0, r1, mid + 1, c1, mask, subgrids);
    }
}

function solveSubgridTSP(r0, r1, c0, c1, mask) {
    let nodes = [];
    for (let r = r0; r <= r1; ++r) for (let c = c0; c <= c1; ++c) if (mask[r][c] === 1) nodes.push([c, r]);
    let n = nodes.length;
    if (n === 0) return [];
    let dist = Array.from({length: n}, () => Array(n).fill(0));
    for (let i = 0; i < n; ++i) for (let j = 0; j < n; ++j) dist[i][j] = Math.abs(nodes[i][0] - nodes[j][0]) + Math.abs(nodes[i][1] - nodes[j][1]);
    let FULL = 1 << n, INF = 1e9;
    let dp = Array.from({length: FULL}, () => Array(n).fill(INF));
    let parent = Array.from({length: FULL}, () => Array(n).fill(-1));
    for (let i = 0; i < n; ++i) dp[1 << i][i] = 0;
    for (let maskVal = 1; maskVal < FULL; ++maskVal) {
        for (let last = 0; last < n; ++last) {
            if (!(maskVal & (1 << last))) continue;
            let prev = maskVal ^ (1 << last);
            if (!prev) continue;
            let best = INF, bk = -1;
            for (let k = 0; k < n; ++k) if (prev & (1 << k)) {
                let cost = dp[prev][k] + dist[k][last];
                if (cost < best) { best = cost; bk = k; }
            }
            dp[maskVal][last] = best; parent[maskVal][last] = bk;
        }
    }
    let fullM = FULL - 1, bc = INF, be = -1;
    for (let i = 0; i < n; ++i) if (dp[fullM][i] < bc) { bc = dp[fullM][i]; be = i; }
    let rev = [], cm = fullM, cn = be;
    while (cn !== -1) {
        rev.push(cn);
        let p = parent[cm][cn]; cm ^= (1 << cn); cn = p;
    }
    rev.reverse();
    return rev.map(i => nodes[i]);
}

function manhattanPath(A, B) {
    let path = [], [x0, y0] = A, [x1, y1] = B;
    let dx = x1 > x0 ? 1 : x1 < x0 ? -1 : 0;
    let curr = [x0, y0];
    while (curr[0] !== x1) { curr = [curr[0] + dx, curr[1]]; path.push([...curr]); }
    let dy = y1 > y0 ? 1 : y1 < y0 ? -1 : 0;
    while (curr[1] !== y1) { curr = [curr[0], curr[1] + dy]; path.push([...curr]); }
    return path;
}

function buildFullPath(subgridTours) {
    let path = [];
    if (!subgridTours.length) return path;
    let first = subgridTours[0]; path.push(first[0]);
    for (let i = 1; i < first.length; ++i) path.push(...manhattanPath(first[i-1], first[i]));
    for (let i = 1; i < subgridTours.length; ++i) {
        let prevEnd = path[path.length - 1];
        let tour = subgridTours[i];
        path.push(...manhattanPath(prevEnd, tour[0]));
        for (let j = 1; j < tour.length; ++j) path.push(...manhattanPath(tour[j-1], tour[j]));
    }
    return path;
}

function highlightSubgrids(ctx) {
    if (!subgrids || !subgridColors.length) return;
    for (let i = 0; i < subgrids.length; i++) {
        const [r0, r1, c0, c1] = subgrids[i];
        ctx.fillStyle = subgridColors[i];
        for (let y = r0; y <= r1; y++)
            for (let x = c0; x <= c1; x++)
                ctx.fillRect(x * TILE_SIZE, y * TILE_SIZE, TILE_SIZE, TILE_SIZE);
    }
    // Optionally, overlay min/max highlights
    ctx.fillStyle = HIGHLIGHT_MIN;
    for (let y = minGrid[0]; y <= minGrid[1]; y++)
        for (let x = minGrid[2]; x <= minGrid[3]; x++)
            ctx.fillRect(x * TILE_SIZE, y * TILE_SIZE, TILE_SIZE, TILE_SIZE);
    ctx.fillStyle = HIGHLIGHT_MAX;
    for (let y = maxGrid[0]; y <= maxGrid[1]; y++)
        for (let x = maxGrid[2]; x <= maxGrid[3]; x++)
            ctx.fillRect(x * TILE_SIZE, y * TILE_SIZE, TILE_SIZE, TILE_SIZE);
}

function drawGrid(ctx) {
    for (let y = 0; y < ROWS; ++y) for (let x = 0; x < COLS; ++x) {
        let color = grassMask[y][x] === 0 ? DIRT_GRAY : mowed[y][x] ? BROWN : GREEN;
        ctx.fillStyle = color;
        ctx.fillRect(x * TILE_SIZE, y * TILE_SIZE, TILE_SIZE, TILE_SIZE);
    }
    highlightSubgrids(ctx);
    if (pathIndex < fullPath.length) {
        let [mx, my] = fullPath[pathIndex];
        ctx.fillStyle = MOWER_COLOR;
        ctx.fillRect(mx * TILE_SIZE, my * TILE_SIZE, TILE_SIZE, TILE_SIZE);
    }
}

function animate() {
    const canvas = document.getElementById('mowing-canvas');
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = WHITE; ctx.fillRect(0, 0, WIDTH, HEIGHT);
    drawGrid(ctx);
    updateTimer();
    if (pathIndex < fullPath.length) {
        let [x, y] = fullPath[pathIndex];
        if (grassMask[y][x] === 1) mowed[y][x] = 1;
        pathIndex++;
        animationId = setTimeout(() => requestAnimationFrame(animate), 1000 / FPS);
    }
}

function startTimer() {
    startTime = Date.now();
    const timerEl = document.getElementById('timer');
    timerInterval = setInterval(updateTimer, 1000);
}

function updateTimer() {
    const now = Date.now();
    const elapsed = Math.floor((now - startTime) / 1000);
    // Estimate remaining time based on mowing progress
    let percentDone = 0;
    if (fullPath && pathIndex !== undefined && fullPath.length > 0) {
        percentDone = pathIndex / fullPath.length;
    }
    let estLeft = estimatedTotalSolveTime * (1 - percentDone);
    estimatedTimeLeft = Math.max(0, Math.round(estLeft));
    const em = String(Math.floor(elapsed/60)).padStart(2,'0');
    const es = String(elapsed%60).padStart(2,'0');
    const rm = String(Math.floor(estimatedTimeLeft/60)).padStart(2,'0');
    const rs = String(estimatedTimeLeft%60).padStart(2,'0');
    document.getElementById('timer').textContent =
        `Elapsed: ${em}:${es} | Est. Remaining: ${rm}:${rs}`;
}

function calibrateThreshold() {
    // Show calibration message
    const timerEl = document.getElementById('timer');
    if (timerEl) timerEl.textContent = "Calibrating...";

    const base = grassMask;
    let bestT = 1;
    let bestTime = 0;
    let bestSubgridCount = 0;
    let bestAvgTime = 0;
    for (let t = 1; t <= MAX_CALIBRATION_T; t++) {
        let s = Date.now();
        let ts = [];
        subdivide(0, ROWS-1, 0, COLS-1, base, ts);
        // If too many subgrids, bail early
        if (ts.length > 100) break;
        let totalSolveTime = 0;
        let maxSolveTime = 0;
        for (let g of ts) {
            let subStart = Date.now();
            solveSubgridTSP(...g, base);
            let subTime = (Date.now() - subStart) / 1000;
            totalSolveTime += subTime;
            if (subTime > maxSolveTime) maxSolveTime = subTime;
            // If any subgrid is too slow, bail
            if (subTime > MAX_SUBGRID_SOLVE_TIME_SEC) break;
        }
        let avgTime = ts.length ? totalSolveTime / ts.length : 0;
        if (maxSolveTime > MAX_SUBGRID_SOLVE_TIME_SEC) break;
        if (totalSolveTime > TARGET_TOTAL_TIME_SEC) break;
        bestT = t;
        bestTime = totalSolveTime;
        bestSubgridCount = ts.length;
        bestAvgTime = avgTime;
    }
    MAX_GRASS_PER_SUBGRID = bestT;
    estimatedTotalSolveTime = bestTime;
    avgSubgridSolveTime = bestAvgTime;
    //console.log(`Calibrated MAX_GRASS_PER_SUBGRID = ${bestT}, est total solve time = ${bestTime.toFixed(2)}s, avg per subgrid = ${bestAvgTime.toFixed(2)}s`);
}

function findMinMax(subs) {
    let areas = subs.map(([r0,r1,c0,c1]) => (r1-r0+1)*(c1-c0+1));
    const minIdx = areas.indexOf(Math.min(...areas));
    const maxIdx = areas.indexOf(Math.max(...areas));
    minGrid = subs[minIdx]; maxGrid = subs[maxIdx];
}

function setupAndStart() {
    if (!document.getElementById('timer')) {
        const te = document.createElement('div'); te.id='timer'; te.style.font='16px monospace';
        te.style.margin='8px'; document.body.insertBefore(te, document.body.firstChild);
    }
    // Show calibration message
    document.getElementById('timer').textContent = "Calibrating...";
    setTimeout(() => {
        startTimer();
        grassMask = createGrassMask();
        calibrateThreshold();
        mowed = Array.from({length: ROWS}, () => Array(COLS).fill(0));
        subgrids = [];
        subdivide(0, ROWS-1, 0, COLS-1, grassMask, subgrids);
        subgridColors = generateSubgridColors(subgrids.length);
        findMinMax(subgrids);
        subgridTours = [];
        let totalSolveTime = 0;
        for (let g of subgrids) {
            let subStart = Date.now();
            const tour = solveSubgridTSP(...g, grassMask);
            let subTime = (Date.now() - subStart) / 1000;
            totalSolveTime += subTime;
            if (tour.length) subgridTours.push(tour);
        }
        estimatedTotalSolveTime = totalSolveTime;
        avgSubgridSolveTime = subgrids.length ? totalSolveTime / subgrids.length : 0;
        fullPath = buildFullPath(subgridTours);
        pathIndex=0; if(animationId) clearTimeout(animationId);
        setTimeout(animate, 500); // Shorter load time for UI
    }, 50); // Let UI update before heavy work
};
document.addEventListener('DOMContentLoaded', () => {
    const startBtn = document.getElementById('start-btn');
    const restartBtn = document.getElementById('restart-btn');
    restartBtn.disabled = true;

    startBtn.addEventListener('click', () => {
        startBtn.disabled = true;
        restartBtn.disabled = false;
        setupAndStart();
    });

    restartBtn.addEventListener('click', setupAndStart);
});