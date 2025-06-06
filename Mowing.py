import pygame
import random
import math
from collections import deque

# ──────── CONFIG ────────
WIDTH, HEIGHT = 600, 600       # window size
TILE_SIZE = 20                 # size of each grid cell
COLS, ROWS = WIDTH // TILE_SIZE, HEIGHT // TILE_SIZE
FPS = 60                       # animation speed

# Maximum grass‐tile count per subgrid for exact Held–Karp
MAX_GRASS_PER_SUBGRID = 20

# ──────── COLORS ────────
GREEN     = (34, 139, 34)      # unmowed grass
BROWN     = (139, 69, 19)      # mowed grass
DIRT_GRAY = (169, 169, 169)    # bare soil / no grass
WHITE     = (255, 255, 255)    # background
MOWER_COLOR = (255, 0, 0)      # mower

pygame.init()
screen = pygame.display.set_mode((WIDTH, HEIGHT))
pygame.display.set_caption("Optimal Lawn Mower (Python)")
clock = pygame.time.Clock()

# ──────── STEP 1: Create an irregular yard mask ────────
# grass_mask[y][x] == 1 means “grass here.” 0 means “bare soil.”
grass_mask = [[1 for _ in range(COLS)] for _ in range(ROWS)]

# 1a) Add some “natural” circular bare‐soil patches
num_circles = random.randint(3, 5)
for _ in range(num_circles):
    cx = random.uniform(0, COLS)
    cy = random.uniform(0, ROWS)
    radius = random.uniform(2, 5)
    for y in range(ROWS):
        for x in range(COLS):
            if math.hypot(x - cx, y - cy) < radius:
                grass_mask[y][x] = 0

# 1b) Add some “sharp-edged” rectangular bare‐soil patches
num_rects = random.randint(2, 4)
for _ in range(num_rects):
    w = random.randint(2, 5)
    h = random.randint(2, 5)
    sx = random.randint(0, COLS - w)
    sy = random.randint(0, ROWS - h)
    for y in range(sy, sy + h):
        for x in range(sx, sx + w):
            grass_mask[y][x] = 0

# ──────── STEP 2: Partition into subgrids (≤ MAX_GRASS_PER_SUBGRID grass cells) ────────
subgrids = []  # list of (r0, r1, c0, c1)

def count_grass(r0, r1, c0, c1):
    cnt = 0
    for r in range(r0, r1 + 1):
        for c in range(c0, c1 + 1):
            if grass_mask[r][c] == 1:
                cnt += 1
    return cnt

def subdivide(r0, r1, c0, c1):
    cnt = count_grass(r0, r1, c0, c1)
    if cnt <= MAX_GRASS_PER_SUBGRID:
        subgrids.append((r0, r1, c0, c1))
        return
    dr = r1 - r0 + 1
    dc = c1 - c0 + 1
    if dr >= dc:
        mid = (r0 + r1) // 2
        subdivide(r0, mid, c0, c1)
        subdivide(mid + 1, r1, c0, c1)
    else:
        mid = (c0 + c1) // 2
        subdivide(r0, r1, c0, mid)
        subdivide(r0, r1, mid + 1, c1)

subdivide(0, ROWS - 1, 0, COLS - 1)

# ──────── Held–Karp on each subgrid ────────
# Returns a list of (x,y) cells in visit order for that subgrid.
def solve_subgrid_tsp(r0, r1, c0, c1):
    # 3a) Gather nodes
    nodes = []
    for r in range(r0, r1 + 1):
        for c in range(c0, c1 + 1):
            if grass_mask[r][c] == 1:
                nodes.append((c, r))
    n = len(nodes)
    if n == 0:
        return []

    # 3b) Build Manhattan distance matrix
    dist = [[0]*n for _ in range(n)]
    for i in range(n):
        x1, y1 = nodes[i]
        for j in range(n):
            x2, y2 = nodes[j]
            dist[i][j] = abs(x1 - x2) + abs(y1 - y2)

    # 3c) DP bitmask table
    FULL = 1 << n
    INF = 10**9
    dp = [[INF]*n for _ in range(FULL)]
    parent = [[-1]*n for _ in range(FULL)]

    # Base: single‐node masks
    for i in range(n):
        dp[1<<i][i] = 0

    # Fill DP
    for mask in range(1, FULL):
        for last in range(n):
            if not (mask & (1<<last)): 
                continue
            prev_mask = mask ^ (1<<last)
            if prev_mask == 0:
                continue
            best = INF
            bestk = -1
            for k in range(n):
                if not (prev_mask & (1<<k)):
                    continue
                cost = dp[prev_mask][k] + dist[k][last]
                if cost < best:
                    best = cost
                    bestk = k
            dp[mask][last] = best
            parent[mask][last] = bestk

    # 3d) Find minimal “end node”
    full_mask = FULL - 1
    best_cost = INF
    best_end = -1
    for i in range(n):
        if dp[full_mask][i] < best_cost:
            best_cost = dp[full_mask][i]
            best_end = i

    # 3e) Reconstruct tour in reverse
    rev = []
    cur_mask = full_mask
    cur_node = best_end
    while cur_node != -1:
        rev.append(cur_node)
        p = parent[cur_mask][cur_node]
        cur_mask ^= (1 << cur_node)
        cur_node = p
    rev.reverse()

    # Map back to coordinates
    tour = [ nodes[i] for i in rev ]
    return tour

# 3f) Solve each subgrid, collect local tours
subgrid_tours = []
for (r0,r1,c0,c1) in subgrids:
    tour = solve_subgrid_tsp(r0, r1, c0, c1)
    if tour:
        subgrid_tours.append(tour)

# ──────── STEP 4: Stitch subgrid tours in the order they were generated ────────
def manhattan_path(A, B):
    # Return a step‐by‐step list from A→B (include B, exclude A)
    path = []
    x0,y0 = A
    x1,y1 = B
    # horizontal
    dx = 1 if x1 > x0 else -1 if x1 < x0 else 0
    curr = (x0, y0)
    while curr[0] != x1:
        curr = (curr[0] + dx, curr[1])
        path.append(curr)
    # vertical
    dy = 1 if y1 > y0 else -1 if y1 < y0 else 0
    while curr[1] != y1:
        curr = (curr[0], curr[1] + dy)
        path.append(curr)
    return path

full_path = []
if subgrid_tours:
    # a) First subgrid’s local tour
    first = subgrid_tours[0]
    full_path.append(first[0])
    for i in range(1, len(first)):
        segment = manhattan_path(first[i-1], first[i])
        full_path.extend(segment)

    # b) For each next subgrid
    for i in range(1, len(subgrid_tours)):
        prev_tour = subgrid_tours[i-1]
        curr_tour = subgrid_tours[i]
        prev_end = full_path[-1]
        curr_start = curr_tour[0]
        # connect prev_end→curr_start
        conn = manhattan_path(prev_end, curr_start)
        full_path.extend(conn)
        # then append local tour
        for j in range(len(curr_tour)):
            if j == 0:
                full_path.append(curr_tour[0])
            else:
                seg = manhattan_path(curr_tour[j-1], curr_tour[j])
                full_path.extend(seg)

# ──────── STEP 5: Animate ────────
mowed = [[0]*COLS for _ in range(ROWS)]
path_index = 0

def draw_grid():
    for y in range(ROWS):
        for x in range(COLS):
            if grass_mask[y][x] == 0:
                color = DIRT_GRAY
            else:
                color = BROWN if mowed[y][x] else GREEN
            rect = (x*TILE_SIZE, y*TILE_SIZE, TILE_SIZE, TILE_SIZE)
            pygame.draw.rect(screen, color, rect)
    if path_index < len(full_path):
        mx, my = full_path[path_index]
        rect = (mx*TILE_SIZE, my*TILE_SIZE, TILE_SIZE, TILE_SIZE)
        pygame.draw.rect(screen, MOWER_COLOR, rect)

running = True
while running:
    clock.tick(FPS)
    screen.fill(WHITE)
    draw_grid()

    if path_index < len(full_path):
        x, y = full_path[path_index]
        if grass_mask[y][x] == 1:
            mowed[y][x] = 1
        path_index += 1

    pygame.display.flip()
    for e in pygame.event.get():
        if e.type == pygame.QUIT:
            running = False

pygame.quit()
