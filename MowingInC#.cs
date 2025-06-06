using System;
using System.Collections.Generic;
using System.Drawing;
using System.Linq;
using System.Windows.Forms;

namespace OptimalLawnMowerCS
{
    public partial class Form1 : Form
    {
        // ──────── CONFIGURATION ────────
        const int WINDOW_WIDTH  = 600;
        const int WINDOW_HEIGHT = 600;
        const int TILE_SIZE     = 20;
        const int GRID_COLS     = WINDOW_WIDTH / TILE_SIZE;  // 30
        const int GRID_ROWS     = WINDOW_HEIGHT / TILE_SIZE; // 30

        // Maximum grass‐tile count per subgrid
        const int MAX_GRASS_PER_SUBGRID = 20;

        // Colors
        readonly Color COLOR_GRASS_UNMOWED = Color.FromArgb(34, 139, 34);
        readonly Color COLOR_GRASS_MOWED   = Color.FromArgb(139, 69, 19);
        readonly Color COLOR_SOIL          = Color.FromArgb(169, 169, 169);
        readonly Color COLOR_MOWER         = Color.Red;
        readonly Color COLOR_BACKGROUND    = Color.White;

        // ──────── YARD DATA ────────
        bool[,] grassMask = new bool[GRID_ROWS, GRID_COLS];
        bool[,] mowed     = new bool[GRID_ROWS, GRID_COLS];

        struct Subgrid { public int r0, r1, c0, c1; }

        List<Subgrid> partitions = new List<Subgrid>();
        List<List<Point>> subgridTours = new List<List<Point>>();
        List<Point> fullRoute = new List<Point>();
        int routeIndex = 0;

        Timer animationTimer;

        public Form1()
        {
            InitializeComponent();
            ClientSize = new Size(WINDOW_WIDTH, WINDOW_HEIGHT);
            Text = "Optimal Lawn Mower (C#)";

            GenerateIrregularYard();
            SubdivideGrid(0, GRID_ROWS - 1, 0, GRID_COLS - 1);
            foreach (var sg in partitions)
            {
                var tour = SolveSubgridTSP(sg);
                if (tour.Count > 0)
                    subgridTours.Add(tour);
            }
            StitchSubgridTours();

            animationTimer = new Timer();
            animationTimer.Interval = 30; // ~30 ms per step
            animationTimer.Tick += (s, e) =>
            {
                if (routeIndex < fullRoute.Count)
                {
                    var p = fullRoute[routeIndex];
                    if (grassMask[p.Y, p.X])
                        mowed[p.Y, p.X] = true;
                    routeIndex++;
                    Invalidate();
                }
                else
                {
                    animationTimer.Stop();
                }
            };
            animationTimer.Start();
        }

        void GenerateIrregularYard()
        {
            var rnd = new Random();
            // start all grass
            for (int r = 0; r < GRID_ROWS; r++)
                for (int c = 0; c < GRID_COLS; c++)
                    grassMask[r, c] = true;

            // random circles
            int numCircles = rnd.Next(3, 7);
            for (int i = 0; i < numCircles; i++)
            {
                double cx = rnd.NextDouble() * GRID_COLS;
                double cy = rnd.NextDouble() * GRID_ROWS;
                double radius = rnd.NextDouble() * 4 + 2; // [2..6)
                for (int r = 0; r < GRID_ROWS; r++)
                {
                    for (int c = 0; c < GRID_COLS; c++)
                    {
                        double dx = c - cx, dy = r - cy;
                        if (Math.Sqrt(dx * dx + dy * dy) < radius)
                            grassMask[r, c] = false;
                    }
                }
            }

            // random rectangles
            int numRects = rnd.Next(2, 5);
            for (int i = 0; i < numRects; i++)
            {
                int w = rnd.Next(2, 7);
                int h = rnd.Next(2, 7);
                int sx = rnd.Next(0, GRID_COLS - w);
                int sy = rnd.Next(0, GRID_ROWS - h);
                for (int r = sy; r < sy + h; r++)
                    for (int c = sx; c < sx + w; c++)
                        grassMask[r, c] = false;
            }
        }

        void SubdivideGrid(int r0, int r1, int c0, int c1)
        {
            int cnt = 0;
            for (int r = r0; r <= r1; r++)
                for (int c = c0; c <= c1; c++)
                    if (grassMask[r, c]) cnt++;

            if (cnt <= MAX_GRASS_PER_SUBGRID)
            {
                partitions.Add(new Subgrid() { r0 = r0, r1 = r1, c0 = c0, c1 = c1 });
                return;
            }

            int dr = r1 - r0 + 1;
            int dc = c1 - c0 + 1;
            if (dr >= dc)
            {
                int mid = (r0 + r1) / 2;
                SubdivideGrid(r0, mid, c0, c1);
                SubdivideGrid(mid + 1, r1, c0, c1);
            }
            else
            {
                int mid = (c0 + c1) / 2;
                SubdivideGrid(r0, r1, c0, mid);
                SubdivideGrid(r0, r1, mid + 1, c1);
            }
        }

        List<Point> SolveSubgridTSP(Subgrid sg)
        {
            // gather grass nodes
            var nodes = new List<Point>();
            for (int r = sg.r0; r <= sg.r1; r++)
                for (int c = sg.c0; c <= sg.c1; c++)
                    if (grassMask[r, c])
                        nodes.Add(new Point(c, r));
            int n = nodes.Count;
            var tour = new List<Point>();
            if (n == 0) return tour;

            // build distance matrix
            int[,] dist = new int[n, n];
            for (int i = 0; i < n; i++)
                for (int j = 0; j < n; j++)
                    dist[i, j] = Math.Abs(nodes[i].X - nodes[j].X) + Math.Abs(nodes[i].Y - nodes[j].Y);

            int FULL = 1 << n;
            const int INF = 1000000000;
            var dp = new int[FULL, n];
            var parent = new int[FULL, n];
            for (int mask = 0; mask < FULL; mask++)
                for (int i = 0; i < n; i++)
                {
                    dp[mask, i] = INF;
                    parent[mask, i] = -1;
                }
            // base cases
            for (int i = 0; i < n; i++)
                dp[1 << i, i] = 0;

            // fill dp
            for (int mask = 1; mask < FULL; mask++)
            {
                for (int last = 0; last < n; last++)
                {
                    if ((mask & (1 << last)) == 0) continue;
                    int pm = mask ^ (1 << last);
                    if (pm == 0) continue;
                    int best = INF, bk = -1;
                    for (int k = 0; k < n; k++)
                    {
                        if ((pm & (1 << k)) == 0) continue;
                        int cost = dp[pm, k] + dist[k, last];
                        if (cost < best)
                        {
                            best = cost;
                            bk = k;
                        }
                    }
                    dp[mask, last] = best;
                    parent[mask, last] = bk;
                }
            }

            // find best end
            int fullMask = FULL - 1, bestEnd = -1, bestCost = INF;
            for (int i = 0; i < n; i++)
            {
                if (dp[fullMask, i] < bestCost)
                {
                    bestCost = dp[fullMask, i];
                    bestEnd = i;
                }
            }

            // reconstruct reverse
            var rev = new List<int>();
            int cm = fullMask, cn = bestEnd;
            while (cn != -1)
            {
                rev.Add(cn);
                int p = parent[cm, cn];
                cm ^= (1 << cn);
                cn = p;
            }
            rev.Reverse();
            foreach (int idx in rev)
                tour.Add(nodes[idx]);
            return tour;
        }

        List<Point> StairPath(Point A, Point B)
        {
            // step by step Manhattan (exclude A, include B)
            var path = new List<Point>();
            int x0 = A.X, y0 = A.Y, x1 = B.X, y1 = B.Y;
            int dx = x1 > x0 ? 1 : x1 < x0 ? -1 : 0;
            var cur = new Point(x0, y0);
            while (cur.X != x1)
            {
                cur.X += dx;
                path.Add(new Point(cur.X, cur.Y));
            }
            int dy = y1 > y0 ? 1 : y1 < y0 ? -1 : 0;
            while (cur.Y != y1)
            {
                cur.Y += dy;
                path.Add(new Point(cur.X, cur.Y));
            }
            return path;
        }

        void StitchSubgridTours()
        {
            if (subgridTours.Count == 0) return;
            // first
            var first = subgridTours[0];
            fullRoute.Add(first[0]);
            for (int i = 1; i < first.Count; i++)
            {
                var seg = StairPath(first[i - 1], first[i]);
                fullRoute.AddRange(seg);
            }

            for (int i = 1; i < subgridTours.Count; i++)
            {
                var prevT = subgridTours[i - 1];
                var currT = subgridTours[i];
                Point pe = fullRoute[fullRoute.Count - 1];
                Point cs = currT[0];
                var conn = StairPath(pe, cs);
                fullRoute.AddRange(conn);
                for (int j = 0; j < currT.Count; j++)
                {
                    if (j == 0)
                    {
                        fullRoute.Add(currT[0]);
                    }
                    else
                    {
                        var s2 = StairPath(currT[j - 1], currT[j]);
                        fullRoute.AddRange(s2);
                    }
                }
            }
        }

        protected override void OnPaint(PaintEventArgs e)
        {
            var g = e.Graphics;
            g.Clear(COLOR_BACKGROUND);

            for (int r = 0; r < GRID_ROWS; r++)
                for (int c = 0; c < GRID_COLS; c++)
                {
                    Brush b;
                    if (!grassMask[r, c]) b = new SolidBrush(COLOR_SOIL);
                    else b = new SolidBrush(mowed[r, c] ? COLOR_GRASS_MOWED : COLOR_GRASS_UNMOWED);
                    g.FillRectangle(b, c * TILE_SIZE, r * TILE_SIZE, TILE_SIZE, TILE_SIZE);
                    b.Dispose();
                }

            if (routeIndex < fullRoute.Count)
            {
                var p = fullRoute[routeIndex];
                var rect = new Rectangle(p.X * TILE_SIZE, p.Y * TILE_SIZE, TILE_SIZE, TILE_SIZE);
                g.FillRectangle(new SolidBrush(COLOR_MOWER), rect);
            }
        }

        private void InitializeComponent()
        {
            this.SuspendLayout();
            // 
            // Form1
            // 
            this.ClientSize = new System.Drawing.Size(WINDOW_WIDTH, WINDOW_HEIGHT);
            this.Name = "Form1";
            this.ResumeLayout(false);
        }

        [STAThread]
        static void Main()
        {
            ApplicationConfiguration.Initialize();
            Application.Run(new Form1());
        }
    }
}
