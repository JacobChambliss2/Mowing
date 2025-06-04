import pygame
import random
import math
from collections import deque

# ──────── CONFIG ────────
WIDTH, HEIGHT = 600, 600       # window size
TILE_SIZE = 20                 # size of each grid cell
COLS, ROWS = WIDTH // TILE_SIZE, HEIGHT // TILE_SIZE
FPS = 60                       # animation speed

# ──────── COLORS ────────
GREEN     = (34, 139, 34)      # unmowed grass
BROWN     = (139, 69, 19)      # mowed grass
DIRT_GRAY = (169, 169, 169)    # bare soil / no grass
WHITE     = (255, 255, 255)    # background
MOWER_COLOR = (255, 0, 0)      # mower

pygame.init()
screen = pygame.display.set_mode((WIDTH, HEIGHT))
pygame.display.set_caption("Optimal Lawn Mower")
clock = pygame.time.Clock()

# ──────── STEP 1: Create an irregular yard mask ────────
# grass_mask[y][x] == 1 means “grass here.” 0 means “bare soil.”
grass_mask = [[1 for _ in range(COLS)] for _ in range(ROWS)]

# 1a) Add some “natural” circular brown/patch areas (no grass)
num_circles = random.randint(3, 6)
for _ in range(num_circles):
    cx = random.uniform(0, COLS)
    cy = random.uniform(0, ROWS)
    radius = random.uniform(2,6)
    for y in range(ROWS):
        for x in range(COLS):
            if math.hypot(x - cx, y - cy) < radius:
                grass_mask[y][x] = 0

# 1b) Add some “sharp-edged” rectangular bare-soil patches
num_rects = random.randint(2, 4)
for _ in range(num_rects):
    w = random.randint(2,6)
    h = random.randint(2,6)
    sx = random.randint(0, COLS - w)
    sy = random.randint(0, ROWS - h)
    for y in range(sy, sy + h):
        for x in range(sx, sx + w):
            grass_mask[y][x] = 0

# ──────── STEP 2: Plan a shortest “coverage” path over all grass cells ────────
#
# We will:
#   • Maintain a set of unvisited grass cells (“unvisited”).
#   • Start from (0,0).  Find the nearest grass cell (BFS distance), walk there.
#   • Each time we walk, we remove any grass cell we pass over from “unvisited.”
#   • Repeat until all grass cells are visited.  This guarantees no teleporting—
#     the mower can only move to adjacent cells (grass or bare soil).

# Track which grass cells still need mowing:
unvisited = set(
    (x, y)
    for y in range(ROWS)
    for x in range(COLS)
    if grass_mask[y][x] == 1
)

# Helper: yield the four neighbors (N/E/S/W), staying in bounds
def neighbors(pos):
    x, y = pos
    for dx, dy in [(1,0), (-1,0), (0,1), (0,-1)]:
        nx, ny = x + dx, y + dy
        if 0 <= nx < COLS and 0 <= ny < ROWS:
            yield (nx, ny)

# BFS to find “nearest” unvisited grass cell and return the path to it.
def find_nearest_and_path(start, unvisited):
    # visited[y][x] marks whether we have enqueued that cell
    visited = [[False] * COLS for _ in range(ROWS)]
    prev = {}  # prev[(nx,ny)] = (x,y) stores predecessor in BFS tree
    q = deque()
    q.append(start)
    visited[start[1]][start[0]] = True

    # If we start on an unvisited grass cell, return [start].
    if start in unvisited:
        return [start]

    while q:
        x, y = q.popleft()
        for nx, ny in neighbors((x, y)):
            if not visited[ny][nx]:
                visited[ny][nx] = True
                prev[(nx, ny)] = (x, y)
                # As soon as we reach any unvisited grass cell, reconstruct path
                if (nx, ny) in unvisited:
                    path = [(nx, ny)]
                    cur = (nx, ny)
                    while cur != start:
                        cur = prev[cur]
                        path.append(cur)
                    path.reverse()
                    return path
                q.append((nx, ny))

    # If no unvisited grass remain, return empty
    return []

# Build the complete sequence “full_path” of every step the mower will take.
full_path = []

if unvisited:
    # 2a) Find nearest grass from (0,0) and walk there
    start_pos = (0, 0)
    path_segment = find_nearest_and_path(start_pos, unvisited)
    for cell in path_segment:
        if cell in unvisited:
            unvisited.remove(cell)
    full_path.extend(path_segment)
    current = path_segment[-1]

    # 2b) While unvisited remains, keep BFS’ing from “current” to nearest grass
    while unvisited:
        segment = find_nearest_and_path(current, unvisited)
        if not segment:
            break
        for cell in segment:
            if cell in unvisited:
                unvisited.remove(cell)
        full_path.extend(segment)
        current = segment[-1]
else:
    # No grass anywhere, so no movement
    full_path = []

# At this point, `full_path` is a list of (x,y) positions the mower will traverse,
# guaranteed to visit every grass cell at least once, with no teleporting.

# Reset mowed grid so we can animate from scratch:
mowed = [[0 for _ in range(COLS)] for _ in range(ROWS)]
path_index = 0  # how far along full_path we have animated

# ──────── STEP 3: DRAW & ANIMATE ────────

def draw_grid():
    # Draw every cell in the 30×30 yard:
    for y in range(ROWS):
        for x in range(COLS):
            if grass_mask[y][x] == 0:
                # This cell has no grass (bare soil)
                color = DIRT_GRAY
            else:
                # This cell has grass:
                # • If already mowed ⇒ BROWN
                # • If still unmowed ⇒ GREEN
                color = BROWN if mowed[y][x] else GREEN

            rect = (x * TILE_SIZE, y * TILE_SIZE, TILE_SIZE, TILE_SIZE)
            pygame.draw.rect(screen, color, rect)

    # Draw the mower as a red square at its current position
    if path_index < len(full_path):
        mx, my = full_path[path_index]
        rect = (mx * TILE_SIZE, my * TILE_SIZE, TILE_SIZE, TILE_SIZE)
        pygame.draw.rect(screen, MOWER_COLOR, rect)

running = True
while running:
    clock.tick(FPS)
    screen.fill(WHITE)
    draw_grid()

    # Advance the mower along the precomputed path, marking grass cells as mowed
    if path_index < len(full_path):
        x, y = full_path[path_index]
        if grass_mask[y][x] == 1:
            mowed[y][x] = 1
        path_index += 1

    pygame.display.flip()

    for event in pygame.event.get():
        if event.type == pygame.QUIT:
            running = False

pygame.quit()
