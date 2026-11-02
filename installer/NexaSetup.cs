// Nexa's installer. A small Windows app, built by make-package.ps1 with the C# compiler that comes
// with Windows (no extra tools). It unpacks Nexa into the user's Programs folder, runs setup.ps1
// (Python, packages, Ollama, the AI brain, voices) with a progress bar, and adds Nexa to
// Settings > Apps so she can be uninstalled. Everything is per-user: no admin rights needed.
using System;
using System.Diagnostics;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Text;
using System.IO;
using System.IO.Compression;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading;
using System.Windows.Forms;
using Microsoft.Win32;

[assembly: AssemblyTitle("Nexa Setup")]
[assembly: AssemblyProduct("Nexa")]
[assembly: AssemblyCompany("Mic Dahryl Caybin")]
[assembly: AssemblyCopyright("Made by Mic Dahryl Caybin")]
[assembly: AssemblyVersion("1.0.0.0")]
[assembly: AssemblyFileVersion("1.0.0.0")]

namespace NexaSetup
{
    static class Program
    {
        [STAThread]
        static void Main()
        {
            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);
            Application.Run(new SetupForm());
        }
    }

    static class Theme
    {
        public static readonly Color Bg = Color.FromArgb(5, 15, 11);
        public static readonly Color Card = Color.FromArgb(11, 26, 20);
        public static readonly Color Line = Color.FromArgb(35, 70, 56);
        public static readonly Color Track = Color.FromArgb(20, 44, 34);
        public static readonly Color Text = Color.FromArgb(226, 243, 234);
        public static readonly Color Muted = Color.FromArgb(139, 169, 155);
        public static readonly Color Accent = Color.FromArgb(14, 138, 84);
        public static readonly Color Cyan = Color.FromArgb(95, 227, 166);
        public static readonly Color Danger = Color.FromArgb(242, 110, 110);

        public static GraphicsPath Round(RectangleF r, float radius)
        {
            float d = Math.Max(1f, Math.Min(radius * 2f, Math.Min(r.Width, r.Height)));
            GraphicsPath p = new GraphicsPath();
            p.AddArc(r.X, r.Y, d, d, 180, 90);
            p.AddArc(r.Right - d, r.Y, d, d, 270, 90);
            p.AddArc(r.Right - d, r.Bottom - d, d, d, 0, 90);
            p.AddArc(r.X, r.Bottom - d, d, d, 90, 90);
            p.CloseFigure();
            return p;
        }
    }

    // A thin rounded progress bar in Nexa's greens.
    class Bar : Control
    {
        public float Value;

        public Bar()
        {
            SetStyle(ControlStyles.AllPaintingInWmPaint | ControlStyles.OptimizedDoubleBuffer | ControlStyles.UserPaint | ControlStyles.ResizeRedraw, true);
            BackColor = Theme.Bg;
        }

        protected override void OnPaint(PaintEventArgs e)
        {
            Graphics g = e.Graphics;
            g.SmoothingMode = SmoothingMode.AntiAlias;
            g.Clear(BackColor);
            RectangleF r = new RectangleF(0.5f, 0.5f, Width - 1.5f, Height - 1.5f);
            using (GraphicsPath track = Theme.Round(r, r.Height / 2f))
            using (SolidBrush b = new SolidBrush(Theme.Track))
                g.FillPath(b, track);
            float w = r.Width * Math.Max(0f, Math.Min(1f, Value));
            if (w >= r.Height)
            {
                RectangleF f = new RectangleF(r.X, r.Y, w, r.Height);
                using (GraphicsPath fill = Theme.Round(f, r.Height / 2f))
                using (LinearGradientBrush lb = new LinearGradientBrush(f, Theme.Accent, Theme.Cyan, LinearGradientMode.Horizontal))
                    g.FillPath(lb, fill);
            }
        }
    }

    class PillButton : Button
    {
        public PillButton(string text, bool primary)
        {
            Text = text;
            FlatStyle = FlatStyle.Flat;
            FlatAppearance.BorderSize = primary ? 0 : 1;
            FlatAppearance.BorderColor = Theme.Line;
            BackColor = primary ? Theme.Accent : Theme.Card;
            ForeColor = Theme.Text;
            FlatAppearance.MouseOverBackColor = primary ? Color.FromArgb(24, 160, 100) : Color.FromArgb(20, 44, 34);
            FlatAppearance.MouseDownBackColor = primary ? Color.FromArgb(10, 112, 68) : Color.FromArgb(14, 34, 26);
            Font = new Font("Segoe UI Semibold", 10f);
            Cursor = Cursors.Hand;
            UseVisualStyleBackColor = false;
        }
    }

    class Stage
    {
        public string Key, Label;
        public float From, To;
        public Stage(string key, float from, float to, string label) { Key = key; From = from; To = to; Label = label; }
    }

    class SetupForm : Form
    {
        const string Maker = "Mic Dahryl Caybin";
        const string Version = "1.0";
        const string UninstallKey = @"Software\Microsoft\Windows\CurrentVersion\Uninstall\Nexa";

        // setup.ps1 announces each step with a line starting "==> "; these map them to the bar.
        // "Python packages" must come before "Python".
        static readonly Stage[] Stages = {
            new Stage("Python packages", 0.10f, 0.30f, "Installing Nexa's components (about 300 MB)"),
            new Stage("NVIDIA", 0.30f, 0.46f, "Adding the graphics-card speed-up (about 2 GB)"),
            new Stage("Ollama", 0.46f, 0.54f, "Installing Ollama, the engine for Nexa's brain"),
            new Stage("AI brain", 0.54f, 0.70f, "Downloading Nexa's brain (about 0.8 GB)"),
            new Stage("hearing and voices", 0.70f, 0.94f, "Downloading Nexa's hearing and voices"),
            new Stage("Shortcuts", 0.94f, 0.99f, "Adding shortcuts"),
            new Stage("Python", 0.03f, 0.10f, "Getting Python ready"),
        };
        static readonly Regex Ansi = new Regex(@"\x1B\[[0-9;?]*[A-Za-z]");

        readonly float S = 1f;
        Image logo;
        Panel welcome, progress, finish;
        TextBox folderBox, logBox;
        CheckBox desktopBox, launchBox;
        Label stepLabel, hintLabel, finishTitle, finishText, folderNote;
        LinkLabel detailsLink;
        Bar bar;
        PillButton installBtn, finishBtn;
        System.Windows.Forms.Timer ticker;
        Process setup;
        volatile bool cancelled, busy;
        bool succeeded, launched, wantDesktop;
        string installDir;
        float stageFrom, stageTo = 0.03f, shown;
        DateTime stageSince = DateTime.Now, started = DateTime.Now;
        readonly StringBuilder log = new StringBuilder();

        [DllImport("dwmapi.dll")]
        static extern int DwmSetWindowAttribute(IntPtr hwnd, int attribute, ref int value, int size);

        int D(float v) { return (int)Math.Round(v * S); }

        public SetupForm()
        {
            using (Graphics g = CreateGraphics()) S = g.DpiX / 96f;
            Text = "Nexa Setup";
            FormBorderStyle = FormBorderStyle.FixedSingle;
            MaximizeBox = false;
            StartPosition = FormStartPosition.CenterScreen;
            BackColor = Theme.Bg;
            ForeColor = Theme.Text;
            Font = new Font("Segoe UI", 10f);
            ClientSize = new Size(D(720), D(480));
            DoubleBuffered = true;
            try { Icon = Icon.ExtractAssociatedIcon(Application.ExecutablePath); } catch { }
            Stream ls = Assembly.GetExecutingAssembly().GetManifestResourceStream("logo.png");
            if (ls != null) logo = Image.FromStream(ls);

            BuildWelcome();
            BuildProgress();
            BuildFinish();
            ShowPage(welcome);

            ticker = new System.Windows.Forms.Timer();
            ticker.Interval = 50;
            ticker.Tick += delegate { Tick(); };
        }

        protected override void OnHandleCreated(EventArgs e)
        {
            base.OnHandleCreated(e);
            try { int on = 1; DwmSetWindowAttribute(Handle, 20, ref on, 4); } catch { } // dark title bar
        }

        // The header: a deep-green band with Nexa's logo inside faint hologram rings.
        protected override void OnPaint(PaintEventArgs e)
        {
            Graphics g = e.Graphics;
            g.SmoothingMode = SmoothingMode.AntiAlias;
            g.TextRenderingHint = TextRenderingHint.AntiAliasGridFit;
            Rectangle head = new Rectangle(0, 0, ClientSize.Width, D(150));
            using (LinearGradientBrush b = new LinearGradientBrush(head, Color.FromArgb(10, 70, 45), Color.FromArgb(4, 16, 11), LinearGradientMode.ForwardDiagonal))
                g.FillRectangle(b, head);
            g.SetClip(head);
            PointF c = new PointF(D(84), D(76));
            for (int i = 0; i < 4; i++)
            {
                float r = D(58 + i * 24);
                using (Pen p = new Pen(Color.FromArgb(46 - i * 9, 110, 230, 170), 1f))
                    g.DrawEllipse(p, c.X - r, c.Y - r, r * 2, r * 2);
            }
            GraphicsState st = g.Save();
            g.TranslateTransform(c.X, c.Y);
            g.RotateTransform(-16);
            using (Pen p = new Pen(Color.FromArgb(80, 95, 227, 166), 1.4f))
                g.DrawEllipse(p, -D(190), -D(36), D(380), D(72));
            g.Restore(st);
            g.ResetClip();
            if (logo != null) g.DrawImage(logo, c.X - D(46), c.Y - D(46), D(92), D(92));
            using (Font f = new Font("Segoe UI Semibold", 24f))
            using (SolidBrush t = new SolidBrush(Theme.Text))
                g.DrawString("Nexa", f, t, D(152), D(28));
            using (Font f = new Font("Segoe UI", 10.5f))
            using (SolidBrush t = new SolidBrush(Color.FromArgb(186, 226, 206)))
                g.DrawString("Your AI assistant, running on your own PC", f, t, D(156), D(76));
            using (Font f = new Font("Segoe UI", 9f))
            using (SolidBrush t = new SolidBrush(Color.FromArgb(130, 190, 160)))
                g.DrawString("Made by " + Maker + "   ·   Version " + Version, f, t, D(157), D(102));
            using (Pen p = new Pen(Color.FromArgb(46, 110, 230, 170)))
                g.DrawLine(p, 0, head.Bottom - 1, head.Right, head.Bottom - 1);
        }

        Panel Page()
        {
            Panel p = new Panel();
            p.Location = new Point(0, D(150));
            p.Size = new Size(ClientSize.Width, ClientSize.Height - D(150));
            p.BackColor = Theme.Bg;
            Controls.Add(p);
            return p;
        }

        Label AddLabel(Panel p, string text, int x, int y, int w, int h, float size, bool strong, Color color)
        {
            Label l = new Label();
            l.Text = text;
            l.Location = new Point(x, y);
            l.Size = new Size(w, h);
            l.Font = new Font(strong ? "Segoe UI Semibold" : "Segoe UI", size);
            l.ForeColor = color;
            l.BackColor = Theme.Bg;
            p.Controls.Add(l);
            return l;
        }

        void ShowPage(Panel page)
        {
            foreach (Panel p in new[] { welcome, progress, finish }) if (p != null) p.Visible = p == page;
        }

        void BuildWelcome()
        {
            welcome = Page();
            int W = welcome.Width, H = welcome.Height, x = D(36), w = W - D(72);
            AddLabel(welcome, "Nexa talks with you, listens for “Hey Nexa”, searches the web, opens your apps " +
                "and keeps working offline. Setup downloads what she needs once (about 3 GB), which takes 10 to 30 minutes.",
                x, D(20), w, D(48), 10f, false, Theme.Muted);
            AddLabel(welcome, "Install folder", x, D(84), w, D(22), 9.5f, true, Theme.Text);
            folderBox = new TextBox();
            folderBox.Location = new Point(x, D(110));
            folderBox.Size = new Size(w - D(116), D(28));
            folderBox.BorderStyle = BorderStyle.FixedSingle;
            folderBox.BackColor = Theme.Card;
            folderBox.ForeColor = Theme.Text;
            folderBox.Text = DefaultFolder();
            welcome.Controls.Add(folderBox);
            PillButton browse = new PillButton("Browse…", false);
            browse.Location = new Point(x + w - D(104), D(108));
            browse.Size = new Size(D(104), D(32));
            browse.Click += delegate { Browse(); };
            welcome.Controls.Add(browse);
            folderNote = AddLabel(welcome, "", x, D(144), w, D(20), 8.5f, false, Color.FromArgb(120, 170, 145));
            if (InstalledFolder() != null) folderNote.Text = "Nexa is already installed here. Setup will update her and keep your settings.";

            desktopBox = Check(welcome, "Add a shortcut to the desktop", x, D(174));
            launchBox = Check(welcome, "Open Nexa when setup finishes", x, D(204));

            installBtn = new PillButton(InstalledFolder() != null ? "Update" : "Install", true);
            installBtn.Size = new Size(D(128), D(40));
            installBtn.Location = new Point(W - D(36) - installBtn.Width, H - D(64));
            installBtn.Click += delegate { StartInstall(); };
            welcome.Controls.Add(installBtn);
            PillButton cancel = new PillButton("Cancel", false);
            cancel.Size = new Size(D(104), D(40));
            cancel.Location = new Point(installBtn.Left - D(12) - cancel.Width, H - D(64));
            cancel.Click += delegate { Close(); };
            welcome.Controls.Add(cancel);
            AcceptButton = installBtn;
        }

        CheckBox Check(Panel p, string text, int x, int y)
        {
            CheckBox c = new CheckBox();
            c.Text = text;
            c.Checked = true;
            c.Location = new Point(x, y);
            c.Size = new Size(D(420), D(26));
            c.ForeColor = Theme.Text;
            c.BackColor = Theme.Bg;
            c.FlatStyle = FlatStyle.Flat;
            c.FlatAppearance.BorderColor = Theme.Line;
            c.FlatAppearance.CheckedBackColor = Theme.Accent;
            c.Cursor = Cursors.Hand;
            p.Controls.Add(c);
            return c;
        }

        void BuildProgress()
        {
            progress = Page();
            int W = progress.Width, H = progress.Height, x = D(36), w = W - D(72);
            stepLabel = AddLabel(progress, "Unpacking Nexa", x, D(22), w, D(30), 13f, true, Theme.Text);
            bar = new Bar();
            bar.Location = new Point(x, D(62));
            bar.Size = new Size(w, D(10));
            progress.Controls.Add(bar);
            hintLabel = AddLabel(progress, "", x, D(82), w, D(22), 9.5f, false, Theme.Muted);
            detailsLink = new LinkLabel();
            detailsLink.Text = "Show details";
            detailsLink.Location = new Point(x, D(110));
            detailsLink.Size = new Size(D(200), D(22));
            detailsLink.LinkColor = Color.FromArgb(120, 230, 180);
            detailsLink.ActiveLinkColor = Theme.Cyan;
            detailsLink.BackColor = Theme.Bg;
            detailsLink.LinkBehavior = LinkBehavior.HoverUnderline;
            detailsLink.Click += delegate
            {
                logBox.Visible = !logBox.Visible;
                detailsLink.Text = logBox.Visible ? "Hide details" : "Show details";
            };
            progress.Controls.Add(detailsLink);
            logBox = new TextBox();
            logBox.Multiline = true;
            logBox.ReadOnly = true;
            logBox.ScrollBars = ScrollBars.Vertical;
            logBox.BorderStyle = BorderStyle.FixedSingle;
            logBox.BackColor = Color.FromArgb(3, 11, 8);
            logBox.ForeColor = Theme.Muted;
            logBox.Font = new Font("Consolas", 8.5f);
            logBox.Location = new Point(x, D(136));
            logBox.Size = new Size(w, H - D(136) - D(76));
            logBox.Visible = false;
            progress.Controls.Add(logBox);
            PillButton cancel = new PillButton("Cancel", false);
            cancel.Size = new Size(D(104), D(40));
            cancel.Location = new Point(W - D(36) - cancel.Width, H - D(64));
            cancel.Click += delegate { Close(); };
            progress.Controls.Add(cancel);
        }

        void BuildFinish()
        {
            finish = Page();
            int W = finish.Width, H = finish.Height;
            finish.Paint += PaintBadge;
            finishTitle = AddLabel(finish, "", D(104), D(24), W - D(140), D(34), 15f, true, Theme.Text);
            finishText = AddLabel(finish, "", D(104), D(62), W - D(140), D(150), 10f, false, Theme.Muted);
            finishBtn = new PillButton("Open Nexa", true);
            finishBtn.Size = new Size(D(128), D(40));
            finishBtn.Location = new Point(W - D(36) - finishBtn.Width, H - D(64));
            finishBtn.Click += delegate
            {
                if (!succeeded) { StartInstall(); return; }
                if (!launched) Launch();
                Close();
            };
            finish.Controls.Add(finishBtn);
            PillButton close = new PillButton("Close", false);
            close.Size = new Size(D(104), D(40));
            close.Location = new Point(finishBtn.Left - D(12) - close.Width, H - D(64));
            close.Click += delegate { Close(); };
            finish.Controls.Add(close);
        }

        // A round badge on the finish page: a check when it worked, "!" when it didn't.
        void PaintBadge(object sender, PaintEventArgs e)
        {
            Graphics g = e.Graphics;
            g.SmoothingMode = SmoothingMode.AntiAlias;
            RectangleF r = new RectangleF(D(36), D(26), D(48), D(48));
            if (succeeded)
            {
                using (LinearGradientBrush b = new LinearGradientBrush(r, Theme.Accent, Theme.Cyan, LinearGradientMode.ForwardDiagonal))
                    g.FillEllipse(b, r);
                using (Pen p = new Pen(Color.White, D(3)))
                {
                    p.StartCap = p.EndCap = LineCap.Round;
                    p.LineJoin = LineJoin.Round;
                    g.DrawLines(p, new[] { new PointF(r.X + r.Width * 0.28f, r.Y + r.Height * 0.52f),
                        new PointF(r.X + r.Width * 0.44f, r.Y + r.Height * 0.68f), new PointF(r.X + r.Width * 0.73f, r.Y + r.Height * 0.36f) });
                }
            }
            else
            {
                using (SolidBrush b = new SolidBrush(Color.FromArgb(70, 242, 110, 110))) g.FillEllipse(b, r);
                using (Pen p = new Pen(Theme.Danger, D(2))) g.DrawEllipse(p, r);
                using (Font f = new Font("Segoe UI Semibold", 18f))
                using (SolidBrush t = new SolidBrush(Theme.Danger))
                {
                    StringFormat sf = new StringFormat();
                    sf.Alignment = StringAlignment.Center;
                    sf.LineAlignment = StringAlignment.Center;
                    g.DrawString("!", f, t, r, sf);
                }
            }
        }

        static string DefaultFolder()
        {
            string installed = InstalledFolder();
            if (installed != null) return installed;
            return Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Programs", "Nexa");
        }

        static string InstalledFolder()
        {
            try
            {
                using (RegistryKey k = Registry.CurrentUser.OpenSubKey(UninstallKey))
                {
                    string dir = k == null ? null : k.GetValue("InstallLocation") as string;
                    return dir != null && Directory.Exists(dir) ? dir : null;
                }
            }
            catch { return null; }
        }

        void Browse()
        {
            using (FolderBrowserDialog dlg = new FolderBrowserDialog())
            {
                dlg.Description = "Choose where to install Nexa. A folder named Nexa is made inside it.";
                if (dlg.ShowDialog(this) == DialogResult.OK)
                    folderBox.Text = Path.GetFileName(dlg.SelectedPath).Equals("Nexa", StringComparison.OrdinalIgnoreCase)
                        ? dlg.SelectedPath : Path.Combine(dlg.SelectedPath, "Nexa");
            }
        }

        void StartInstall()
        {
            string dir = folderBox.Text.Trim();
            if (dir.Length == 0 || !Path.IsPathRooted(dir))
            {
                MessageBox.Show(this, "Choose a full folder path, like " + DefaultFolder(), "Nexa Setup", MessageBoxButtons.OK, MessageBoxIcon.Information);
                return;
            }
            installDir = Path.GetFullPath(dir).TrimEnd('\\');
            wantDesktop = desktopBox.Checked;
            succeeded = false;
            cancelled = false;
            busy = true;
            started = DateTime.Now;
            shown = 0f;
            SetStage(0f, 0.03f, "Unpacking Nexa");
            ShowPage(progress);
            ticker.Start();
            Thread t = new Thread(Install);
            t.IsBackground = true;
            t.Start();
        }

        void Install()
        {
            try
            {
                Directory.CreateDirectory(installDir);
                using (Stream s = Assembly.GetExecutingAssembly().GetManifestResourceStream("payload.zip"))
                using (ZipArchive zip = new ZipArchive(s, ZipArchiveMode.Read))
                {
                    foreach (ZipArchiveEntry entry in zip.Entries)
                    {
                        string name = entry.FullName.Replace('/', '\\').TrimStart('\\');
                        string target = Path.GetFullPath(Path.Combine(installDir, name));
                        if (!target.StartsWith(installDir + "\\", StringComparison.OrdinalIgnoreCase)) continue; // never outside the folder
                        if (name.EndsWith("\\") || entry.Name.Length == 0) { Directory.CreateDirectory(target); continue; }
                        Directory.CreateDirectory(Path.GetDirectoryName(target));
                        entry.ExtractToFile(target, true);
                    }
                }
                // Marks a folder Nexa's installer made, so uninstall.ps1 only ever removes such a folder.
                File.WriteAllText(Path.Combine(installDir, ".nexa-installed"), Version);
                SetStage(0.03f, 0.10f, "Getting Python ready");

                int code = RunSetup();
                if (cancelled) return;
                if (code != 0) { Finished(false); return; }
                Register();
                Finished(true);
            }
            catch (Exception ex)
            {
                if (cancelled) return;
                AddLog("Setup error: " + ex.Message);
                Finished(false);
            }
        }

        int RunSetup()
        {
            string script = Path.Combine(installDir, "setup.ps1");
            string args = "-NoProfile -ExecutionPolicy Bypass -Command \"& { [Console]::OutputEncoding = [Text.Encoding]::UTF8; & '"
                + script.Replace("'", "''") + "'" + (wantDesktop ? "" : " -NoDesktop") + "; exit $LASTEXITCODE }\"";
            ProcessStartInfo psi = new ProcessStartInfo("powershell.exe", args);
            psi.UseShellExecute = false;
            psi.CreateNoWindow = true;
            psi.RedirectStandardOutput = true;
            psi.RedirectStandardError = true;
            psi.StandardOutputEncoding = Encoding.UTF8;
            psi.StandardErrorEncoding = Encoding.UTF8;
            psi.WorkingDirectory = installDir;
            setup = new Process();
            setup.StartInfo = psi;
            setup.OutputDataReceived += delegate(object s, DataReceivedEventArgs e) { OnLine(e.Data); };
            setup.ErrorDataReceived += delegate(object s, DataReceivedEventArgs e) { OnLine(e.Data); };
            setup.Start();
            setup.BeginOutputReadLine();
            setup.BeginErrorReadLine();
            setup.WaitForExit();
            setup.WaitForExit(); // lets the last output lines arrive
            return setup.ExitCode;
        }

        void OnLine(string raw)
        {
            if (raw == null) return;
            string line = Ansi.Replace(raw, "");
            int cr = line.LastIndexOf('\r');
            if (cr >= 0) line = line.Substring(cr + 1);
            line = line.TrimEnd();
            if (line.Trim().Length == 0) return;
            AddLog(line);
            string t = line.Trim();
            if (!t.StartsWith("==> ")) return;
            foreach (Stage st in Stages)
            {
                if (t.IndexOf(st.Key, StringComparison.OrdinalIgnoreCase) >= 0) { SetStage(st.From, st.To, st.Label); break; }
            }
        }

        void AddLog(string line)
        {
            lock (log)
            {
                log.AppendLine(line);
                if (log.Length > 200000) log.Remove(0, log.Length - 150000);
            }
            UI(delegate
            {
                logBox.AppendText(line + Environment.NewLine);
                if (logBox.TextLength > 200000) logBox.Text = logBox.Text.Substring(logBox.TextLength - 150000);
            });
        }

        void SetStage(float from, float to, string label)
        {
            stageFrom = from;
            stageTo = to;
            stageSince = DateTime.Now;
            UI(delegate { stepLabel.Text = label; });
        }

        // The bar eases toward the end of the current step, so it keeps moving during long downloads.
        void Tick()
        {
            double inStep = (DateTime.Now - stageSince).TotalSeconds;
            float target = stageFrom + (stageTo - stageFrom) * (float)(1 - Math.Exp(-inStep / 75.0));
            shown = Math.Max(shown, target);
            bar.Value = shown;
            bar.Invalidate();
            int minutes = (int)(DateTime.Now - started).TotalMinutes;
            hintLabel.Text = "This takes 10 to 30 minutes, and you can keep using your PC." +
                (minutes > 0 ? "   ·   " + minutes + (minutes == 1 ? " minute" : " minutes") + " so far" : "");
        }

        void Register()
        {
            using (RegistryKey k = Registry.CurrentUser.CreateSubKey(UninstallKey))
            {
                k.SetValue("DisplayName", "Nexa");
                k.SetValue("DisplayVersion", Version);
                k.SetValue("Publisher", Maker);
                k.SetValue("DisplayIcon", Path.Combine(installDir, @"static\nexa.ico"));
                k.SetValue("InstallLocation", installDir);
                k.SetValue("InstallDate", DateTime.Now.ToString("yyyyMMdd"));
                k.SetValue("UninstallString", "powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File \""
                    + Path.Combine(installDir, "uninstall.ps1") + "\"");
                k.SetValue("NoModify", 1, RegistryValueKind.DWord);
                k.SetValue("NoRepair", 1, RegistryValueKind.DWord);
                k.SetValue("EstimatedSize", (int)Math.Min(int.MaxValue, FolderSize(installDir) / 1024), RegistryValueKind.DWord);
            }
        }

        static long FolderSize(string dir)
        {
            long size = 0;
            try
            {
                foreach (string f in Directory.EnumerateFiles(dir, "*", SearchOption.AllDirectories))
                {
                    try { size += new FileInfo(f).Length; } catch { }
                }
            }
            catch { }
            return size;
        }

        void Finished(bool ok)
        {
            succeeded = ok;
            busy = false;
            UI(delegate
            {
                ticker.Stop();
                if (ok)
                {
                    bar.Value = 1f;
                    finishTitle.Text = "Nexa is ready";
                    string where = "the Start menu" + (wantDesktop ? " or your desktop" : "");
                    if (launchBox.Checked)
                    {
                        Launch();
                        finishText.Text = "Nexa is opening now. Say “Hey Nexa” whenever you want to talk.\n\n" +
                            "Find her later in " + where + ". To remove her, use Settings > Apps.";
                        finishBtn.Text = "Done";
                    }
                    else
                    {
                        finishText.Text = "Open her from " + where + ", then say “Hey Nexa”. To remove her, use Settings > Apps.";
                        finishBtn.Text = "Open Nexa";
                    }
                }
                else
                {
                    finishTitle.Text = "Setup didn't finish";
                    finishText.Text = "Check your internet connection and try again; setup picks up where it stopped.\n\n" + LastLines(4);
                    finishBtn.Text = "Try again";
                }
                ShowPage(finish);
                finish.Invalidate();
            });
        }

        string LastLines(int count)
        {
            string[] lines;
            lock (log) lines = log.ToString().Split(new[] { Environment.NewLine }, StringSplitOptions.RemoveEmptyEntries);
            int from = Math.Max(0, lines.Length - count);
            return string.Join("\n", lines, from, lines.Length - from);
        }

        void Launch()
        {
            launched = true;
            try
            {
                // pythonw runs her without a console window, the same way her shortcut does.
                ProcessStartInfo psi = new ProcessStartInfo(Path.Combine(installDir, @".venv\Scripts\pythonw.exe"),
                    "\"" + Path.Combine(installDir, "server.py") + "\" --launch");
                psi.WorkingDirectory = installDir;
                psi.UseShellExecute = false;
                Process.Start(psi);
            }
            catch (Exception ex)
            {
                MessageBox.Show(this, "Couldn't open Nexa: " + ex.Message, "Nexa Setup", MessageBoxButtons.OK, MessageBoxIcon.Warning);
            }
        }

        protected override void OnFormClosing(FormClosingEventArgs e)
        {
            if (busy && !cancelled)
            {
                DialogResult answer = MessageBox.Show(this, "Stop installing Nexa? Run setup again later and it continues where it stopped.",
                    "Nexa Setup", MessageBoxButtons.YesNo, MessageBoxIcon.Question);
                if (answer != DialogResult.Yes) { e.Cancel = true; return; }
                cancelled = true;
                try
                {
                    if (setup != null && !setup.HasExited)
                    {
                        // Stop setup and everything it started (pip, winget, downloads).
                        ProcessStartInfo kill = new ProcessStartInfo("taskkill", "/PID " + setup.Id + " /T /F");
                        kill.CreateNoWindow = true;
                        kill.UseShellExecute = false;
                        Process.Start(kill).WaitForExit(5000);
                    }
                }
                catch { }
            }
            base.OnFormClosing(e);
        }

        void UI(MethodInvoker action)
        {
            if (IsDisposed) return;
            if (InvokeRequired) { try { BeginInvoke(action); } catch (ObjectDisposedException) { } catch (InvalidOperationException) { } }
            else action();
        }
    }
}
