import { useState, useEffect, useRef } from "react";
import { questions } from "./questions.js";


// ─── GAME COMPONENT ───

const DEFAULT_TIME = 180; // seconds per question

export default function LSATGame() {
  const [screen, setScreen] = useState("home"); // home | playing | review | results | leaderboard
  const [currentQ, setCurrentQ] = useState(0);
  const [selected, setSelected] = useState(null);
  const [confirmed, setConfirmed] = useState(false);
  const [answers, setAnswers] = useState([]);
  const [timerSetting, setTimerSetting] = useState(DEFAULT_TIME);
  const [timeLeft, setTimeLeft] = useState(DEFAULT_TIME);
  const [timedOut, setTimedOut] = useState(false);
  const [streak, setStreak] = useState(0);
  const [bestStreak, setBestStreak] = useState(0);
  const [shuffledQuestions, setShuffledQuestions] = useState([]);
  const [questionCount, setQuestionCount] = useState(10);
  const timerRef = useRef(null);

  // Seen questions tracking
  const [seenIds, setSeenIds] = useState(() => {
    try { return new Set(JSON.parse(localStorage.getItem("lsat-seen") || "[]")); }
    catch { return new Set(); }
  });

  // Player count
  const [playerCount, setPlayerCount] = useState(null);

  // Leaderboard
  const [leaderboard, setLeaderboard] = useState([]);
  const [lbLoading, setLbLoading] = useState(false);
  const [lbName, setLbName] = useState(() => localStorage.getItem("lsat-name") || "");
  const [lbSubmitted, setLbSubmitted] = useState(false);
  const [lbUuid] = useState(() => {
    let id = localStorage.getItem("lsat-uuid");
    if (!id) { id = crypto.randomUUID(); localStorage.setItem("lsat-uuid", id); }
    return id;
  });

  const fetchLeaderboard = async () => {
    setLbLoading(true);
    try {
      const r = await fetch("/api/leaderboard");
      const data = await r.json();
      if (data.entries) setLeaderboard(data.entries);
    } catch { /* leaderboard unavailable */ }
    setLbLoading(false);
  };

  const submitScore = async (name, correct, total) => {
    const trimmed = name.trim().substring(0, 20);
    if (!trimmed) return;
    localStorage.setItem("lsat-name", trimmed);
    setLbName(trimmed);
    setLbLoading(true);
    try {
      const r = await fetch("/api/leaderboard", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ uuid: lbUuid, name: trimmed, correct, total }),
      });
      const data = await r.json();
      if (data.entries) setLeaderboard(data.entries);
      setLbSubmitted(true);
    } catch { /* leaderboard unavailable */ }
    setLbLoading(false);
  };

  // Derived: unseen questions
  const unseenQuestions = questions.filter((q) => !seenIds.has(q.id));
  const remainingCount = unseenQuestions.length;
  const allDone = remainingCount === 0;

  // Fetch player count on mount
  useEffect(() => {
    fetch("/api/played")
      .then((r) => r.json())
      .then((d) => { if (d.count) setPlayerCount(d.count); })
      .catch(() => {});
  }, []);

  // Save seen IDs + register play when a game finishes
  useEffect(() => {
    if (screen === "results" && shuffledQuestions.length > 0) {
      const newSeen = new Set(seenIds);
      shuffledQuestions.forEach((q) => newSeen.add(q.id));
      setSeenIds(newSeen);
      localStorage.setItem("lsat-seen", JSON.stringify([...newSeen]));
      // Register this player
      fetch("/api/played", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ uuid: lbUuid }),
      })
        .then((r) => r.json())
        .then((d) => { if (d.count) setPlayerCount(d.count); })
        .catch(() => {});
    }
  }, [screen]);

  const resetProgress = () => {
    setSeenIds(new Set());
    localStorage.removeItem("lsat-seen");
  };

  // Responsive
  const [isMobile, setIsMobile] = useState(typeof window !== "undefined" && window.innerWidth < 600);
  useEffect(() => {
    const onResize = () => setIsMobile(window.innerWidth < 600);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  // Shuffle on game start — only unseen questions
  const startGame = (count) => {
    const pool = questions.filter((q) => !seenIds.has(q.id));
    const actual = Math.min(count, pool.length);
    if (actual === 0) return;
    const shuffled = [...pool].sort(() => Math.random() - 0.5).slice(0, actual);
    setShuffledQuestions(shuffled);
    setQuestionCount(actual);
    setCurrentQ(0);
    setSelected(null);
    setConfirmed(false);
    setAnswers([]);
    setTimeLeft(timerSetting);
    setTimedOut(false);
    setStreak(0);
    setBestStreak(0);
    setLbSubmitted(false);
    setScreen("playing");
  };

  // Timer
  useEffect(() => {
    if (screen === "playing" && !confirmed && !timedOut) {
      timerRef.current = setInterval(() => {
        setTimeLeft((t) => {
          if (t <= 1) {
            clearInterval(timerRef.current);
            setTimedOut(true);
            setConfirmed(true);
            setAnswers((prev) => [
              ...prev,
              { questionId: shuffledQuestions[currentQ].id, selected: null, correct: false, timedOut: true },
            ]);
            setStreak(0);
            return 0;
          }
          return t - 1;
        });
      }, 1000);
    }
    return () => clearInterval(timerRef.current);
  }, [screen, confirmed, timedOut, currentQ, shuffledQuestions]);

  const handleConfirm = () => {
    if (selected === null || confirmed) return;
    clearInterval(timerRef.current);
    const q = shuffledQuestions[currentQ];
    const isCorrect = selected === q.correct;
    setConfirmed(true);
    const newStreak = isCorrect ? streak + 1 : 0;
    setStreak(newStreak);
    if (newStreak > bestStreak) setBestStreak(newStreak);
    setAnswers((prev) => [
      ...prev,
      { questionId: q.id, selected, correct: isCorrect, timedOut: false },
    ]);
  };

  const handleNext = () => {
    if (currentQ + 1 >= shuffledQuestions.length) {
      setScreen("results");
    } else {
      setCurrentQ(currentQ + 1);
      setSelected(null);
      setConfirmed(false);
      setTimedOut(false);
      setTimeLeft(timerSetting);
    }
  };

  const totalCorrect = answers.filter((a) => a.correct).length;
  const q = shuffledQuestions[currentQ];

  // ─── TIMER BAR COLOR ───
  const timerPct = (timeLeft / timerSetting) * 100;
  const timerColor = timeLeft > 30 ? "#4ade80" : timeLeft > 10 ? "#facc15" : "#ef4444";

  // ─── HOME SCREEN ───
  if (screen === "home") {
    return (
      <div style={styles.container}>
        <div style={{...styles.homeCard, ...(isMobile ? { padding: "28px 20px" } : {})}}>
          <div style={styles.logoRow}>
            <img src="/logo.png" alt="Lawyered logo" style={{...styles.logoImg, ...(isMobile ? { width: 90 } : {})}} />
          </div>
          <h1 style={{...styles.title, ...(isMobile ? { fontSize: 28 } : {})}}>Lawyered's</h1>
          <h2 style={{...styles.subtitle, ...(isMobile ? { fontSize: 16 } : {})}}>LSAT Fun Time Game</h2>
          <p style={styles.tagline}>
            Logical Reasoning make good critical think
          </p>
          <p style={styles.freeBadge}>Always Free</p>
          {playerCount !== null && (
            <p style={styles.playerCount}>
              {playerCount.toLocaleString()} players and counting
            </p>
          )}
          {allDone ? (
            <div style={styles.allDoneBox}>
              <div style={{ fontSize: 40, marginBottom: 12 }}>🎉</div>
              <p style={{ color: "#f1f5f9", fontSize: 18, fontWeight: 600, marginBottom: 8, fontFamily: "sans-serif" }}>
                You've conquered all {questions.length} questions!
              </p>
              <p style={{ color: "#94a3b8", fontSize: 14, lineHeight: 1.6, marginBottom: 16, fontFamily: "sans-serif" }}>
                Tell{" "}
                <a href="https://x.com/BitGrateful" target="_blank" rel="noopener noreferrer" style={styles.link}>
                  @BitGrateful
                </a>
                {" "}on X to make more.
              </p>
              <button style={styles.resetBtn} onClick={resetProgress}>
                Reset &amp; Play Again
              </button>
            </div>
          ) : (
            <>
              <div style={styles.modeSection}>
                <p style={styles.modeLabel}>Questions:</p>
                <div style={styles.modeButtons}>
                  {[
                    { count: 5, label: "Quick Round" },
                    { count: 15, label: "Full Set", primary: true },
                    { count: 25, label: "Marathon" },
                  ].map(({ count, label, primary }) => {
                    const actual = Math.min(count, remainingCount);
                    const disabled = actual === 0;
                    return (
                      <button
                        key={count}
                        style={{
                          ...styles.modeBtn,
                          ...(primary && !disabled ? styles.modeBtnPrimary : {}),
                          ...(disabled ? { opacity: 0.3, cursor: "not-allowed" } : {}),
                        }}
                        onClick={() => !disabled && startGame(count)}
                        disabled={disabled}
                      >
                        <span style={styles.modeNum}>{actual}</span>
                        <span style={styles.modeWord}>{label}</span>
                      </button>
                    );
                  })}
                </div>
                <p style={styles.remainingText}>{remainingCount} of {questions.length} unseen</p>
              </div>
              <div style={styles.timerRow}>
                <span style={styles.timerLabel}>Per question:</span>
                {[180, 120, 90].map((t) => (
                  <button
                    key={t}
                    style={{...styles.timerChip, ...(timerSetting === t ? styles.timerChipActive : {})}}
                    onClick={() => setTimerSetting(t)}
                  >
                    {t >= 120 ? `${t / 60}m` : "1:30"}
                  </button>
                ))}
              </div>
            </>
          )}
          <p style={styles.footer}>Logical Reasoning only</p>
          <button style={styles.lbLink} onClick={() => { fetchLeaderboard(); setScreen("leaderboard"); }}>
            🏆 Leaderboard
          </button>
          <p style={styles.disclaimerText}>
            Not real LSAT questions. Just for fun.{" "}
            <a href="https://creativecommons.org/licenses/by/4.0/" target="_blank" rel="noopener noreferrer" style={styles.link}>
              CC BY 4.0
            </a>
          </p>
          <div style={styles.creatorRow}>
            Created by{" "}
            <a href="https://x.com/BitGrateful/" target="_blank" rel="noopener noreferrer" style={styles.link}>
              @BitGrateful
            </a>
          </div>
        </div>
      </div>
    );
  }

  // ─── RESULTS SCREEN ───
  if (screen === "results") {
    const pct = Math.round((totalCorrect / shuffledQuestions.length) * 100);
    const grade =
      pct >= 90 ? "Outstanding!" : pct >= 70 ? "Strong work!" : pct >= 50 ? "Getting there!" : "Keep practicing!";
    const gradeEmoji = pct >= 90 ? "🏆" : pct >= 70 ? "🎯" : pct >= 50 ? "📚" : "💪";

    return (
      <div style={styles.container}>
        <div style={{...styles.resultsCard, ...(isMobile ? { padding: "28px 20px" } : {})}}>
          <div style={{ fontSize: 48 }}>{gradeEmoji}</div>
          <h1 style={styles.resultsTitle}>{grade}</h1>
          <div style={styles.scoreCircle}>
            <span style={styles.scoreBig}>{totalCorrect}</span>
            <span style={styles.scoreSmall}>/ {shuffledQuestions.length}</span>
          </div>
          <p style={styles.resultsPct}>{pct}% correct</p>
          <div style={styles.statsRow}>
            <div style={styles.statBox}>
              <span style={styles.statNum}>{bestStreak}</span>
              <span style={styles.statLabel}>Best Streak</span>
            </div>
            <div style={styles.statBox}>
              <span style={styles.statNum}>
                {answers.filter((a) => a.timedOut).length}
              </span>
              <span style={styles.statLabel}>Timed Out</span>
            </div>
          </div>
          {/* Leaderboard submission */}
          {!lbSubmitted ? (
            <div style={styles.lbSubmitBox}>
              <p style={{ color: "#94a3b8", fontSize: 13, marginBottom: 8, fontFamily: "sans-serif" }}>Submit your score:</p>
              <div style={{ display: "flex", gap: 8 }}>
                <input
                  type="text"
                  placeholder="Your name"
                  maxLength={20}
                  value={lbName}
                  onChange={(e) => setLbName(e.target.value)}
                  style={styles.lbInput}
                />
                <button
                  style={styles.lbSubmitBtn}
                  disabled={!lbName.trim() || lbLoading}
                  onClick={() => submitScore(lbName, totalCorrect, shuffledQuestions.length)}
                >
                  {lbLoading ? "..." : "Submit"}
                </button>
              </div>
            </div>
          ) : (
            <button
              style={{ ...styles.lbLink, marginBottom: 12 }}
              onClick={() => { fetchLeaderboard(); setScreen("leaderboard"); }}
            >
              🏆 View Leaderboard
            </button>
          )}
          <button
            style={styles.reviewBtn}
            onClick={() => {
              setCurrentQ(0);
              setScreen("review");
            }}
          >
            Review Answers
          </button>
          <button style={{ ...styles.primaryBtn, marginTop: 12 }} onClick={() => setScreen("home")}>
            Play Again
          </button>
        </div>
      </div>
    );
  }

  // ─── LEADERBOARD SCREEN ───
  if (screen === "leaderboard") {
    return (
      <div style={styles.container}>
        <div style={{...styles.resultsCard, maxWidth: 560, ...(isMobile ? { padding: "28px 16px" } : {})}}>
          <h1 style={styles.lbTitle}>🏆 Leaderboard</h1>
          <p style={styles.lbSubtitle}>Top 50 scores</p>
          {lbLoading ? (
            <p style={{ color: "#94a3b8", fontSize: 14, marginTop: 24 }}>Loading...</p>
          ) : leaderboard.length === 0 ? (
            <p style={{ color: "#64748b", fontSize: 14, marginTop: 24 }}>
              No scores yet. Be the first!
            </p>
          ) : (
            <div style={styles.lbTable}>
              <div style={styles.lbHeaderRow}>
                <span style={{...styles.lbHeaderCell, width: 36}}>#</span>
                <span style={{...styles.lbHeaderCell, flex: 1, textAlign: "left"}}>Name</span>
                <span style={{...styles.lbHeaderCell, width: 60}}>Score</span>
                <span style={{...styles.lbHeaderCell, width: 60}}>Q's</span>
                <span style={{...styles.lbHeaderCell, width: 70, ...(isMobile ? { display: "none" } : {})}}>Date</span>
              </div>
              {leaderboard.map((entry) => (
                <div
                  key={entry.rank}
                  style={{
                    ...styles.lbRow,
                    ...(entry.isYou ? styles.lbRowYou : {}),
                  }}
                >
                  <span style={{...styles.lbCell, width: 36, fontWeight: 700, color: entry.rank <= 3 ? "#fbbf24" : "#64748b"}}>
                    {entry.rank <= 3 ? ["🥇","🥈","🥉"][entry.rank - 1] : entry.rank}
                  </span>
                  <span style={{...styles.lbCell, flex: 1, textAlign: "left", color: entry.isYou ? "#60a5fa" : "#e2e8f0", fontWeight: entry.isYou ? 700 : 400}}>
                    {entry.name}{entry.isYou ? " (you)" : ""}
                  </span>
                  <span style={{...styles.lbCell, width: 60, fontWeight: 700, color: entry.pct >= 80 ? "#4ade80" : entry.pct >= 50 ? "#fbbf24" : "#94a3b8"}}>
                    {entry.pct}%
                  </span>
                  <span style={{...styles.lbCell, width: 60, color: "#64748b"}}>
                    {entry.correct}/{entry.total}
                  </span>
                  <span style={{...styles.lbCell, width: 70, color: "#475569", fontSize: 11, ...(isMobile ? { display: "none" } : {})}}>
                    {entry.date}
                  </span>
                </div>
              ))}
            </div>
          )}
          <button style={{ ...styles.primaryBtn, marginTop: 24 }} onClick={() => setScreen("home")}>
            Back to Home
          </button>
        </div>
      </div>
    );
  }

  // ─── REVIEW SCREEN ───
  if (screen === "review") {
    const reviewQ = shuffledQuestions[currentQ];
    const ans = answers[currentQ];
    return (
      <div style={styles.container}>
        <div style={{...styles.gameCard, ...(isMobile ? { padding: "16px 14px 16px" } : {})}}>
          <div style={styles.topBar}>
            <span style={styles.qCount}>
              Review {currentQ + 1} / {shuffledQuestions.length}
            </span>
            <span
              style={{
                ...styles.typeBadge,
                background: ans.correct ? "#065f46" : "#7f1d1d",
                color: ans.correct ? "#6ee7b7" : "#fca5a5",
              }}
            >
              {ans.correct ? "✓ Correct" : ans.timedOut ? "⏱ Timed Out" : "✗ Incorrect"}
            </span>
          </div>
          <div style={{...styles.stimulus, ...(isMobile ? { padding: "12px 14px", fontSize: 14 } : {})}}>{reviewQ.stimulus}</div>
          <p style={styles.stem}>{reviewQ.stem}</p>
          <div style={styles.choices}>
            {reviewQ.choices.map((c) => {
              const isCorrectChoice = c.letter === reviewQ.correct;
              const wasSelected = c.letter === ans.selected;
              let bg = "transparent";
              let border = "1px solid #334155";
              let color = "#e2e8f0";
              if (isCorrectChoice) {
                bg = "#065f4620";
                border = "2px solid #4ade80";
                color = "#4ade80";
              } else if (wasSelected && !ans.correct) {
                bg = "#7f1d1d20";
                border = "2px solid #ef4444";
                color = "#fca5a5";
              }
              return (
                <div key={c.letter} style={{ ...styles.choice, background: bg, border, color, cursor: "default" }}>
                  <span style={{ ...styles.choiceLetter, borderColor: isCorrectChoice ? "#4ade80" : wasSelected ? "#ef4444" : "#475569" }}>
                    {c.letter}
                  </span>
                  <span>{c.text}</span>
                </div>
              );
            })}
          </div>
          <div style={styles.explanationBox}>
            <strong style={{ color: "#fbbf24" }}>Explanation:</strong> {reviewQ.explanation}
          </div>
          <div style={styles.navRow}>
            {currentQ > 0 && (
              <button style={styles.secondaryBtn} onClick={() => setCurrentQ(currentQ - 1)}>
                ← Previous
              </button>
            )}
            <div style={{ flex: 1 }} />
            {currentQ < shuffledQuestions.length - 1 ? (
              <button style={styles.primaryBtn} onClick={() => setCurrentQ(currentQ + 1)}>
                Next →
              </button>
            ) : (
              <button style={styles.primaryBtn} onClick={() => setScreen("home")}>
                Back to Home
              </button>
            )}
          </div>
        </div>
      </div>
    );
  }

  // ─── PLAYING SCREEN ───
  return (
    <div style={styles.container}>
      <div style={{...styles.gameCard, ...(isMobile ? { padding: "16px 14px 16px" } : {})}}>
        {/* Top bar */}
        <div style={styles.topBar}>
          <span style={styles.qCount}>
            {currentQ + 1} / {shuffledQuestions.length}
          </span>
          <span style={styles.typeBadge}>{q.type}</span>
          {streak >= 2 && (
            <span style={styles.streakBadge}>🔥 {streak}</span>
          )}
        </div>

        {/* Timer bar */}
        <div style={styles.timerTrack}>
          <div
            style={{
              ...styles.timerFill,
              width: `${timerPct}%`,
              backgroundColor: timerColor,
            }}
          />
        </div>
        <div style={styles.timerText}>{Math.floor(timeLeft / 60)}:{String(timeLeft % 60).padStart(2, "0")}</div>

        {/* Stimulus */}
        <div style={{...styles.stimulus, ...(isMobile ? { padding: "12px 14px", fontSize: 14 } : {})}}>{q.stimulus}</div>

        {/* Stem */}
        <p style={styles.stem}>{q.stem}</p>

        {/* Choices */}
        <div style={styles.choices}>
          {q.choices.map((c) => {
            let bg = "transparent";
            let border = "1px solid #334155";
            let color = "#e2e8f0";

            if (confirmed || timedOut) {
              if (c.letter === q.correct) {
                bg = "#065f4620";
                border = "2px solid #4ade80";
                color = "#4ade80";
              } else if (c.letter === selected && c.letter !== q.correct) {
                bg = "#7f1d1d20";
                border = "2px solid #ef4444";
                color = "#fca5a5";
              }
            } else if (c.letter === selected) {
              bg = "#1e3a5f";
              border = "2px solid #60a5fa";
              color = "#93c5fd";
            }

            return (
              <div
                key={c.letter}
                onClick={() => {
                  if (!confirmed && !timedOut) setSelected(c.letter);
                }}
                style={{
                  ...styles.choice,
                  background: bg,
                  border,
                  color,
                  cursor: confirmed || timedOut ? "default" : "pointer",
                }}
              >
                <span
                  style={{
                    ...styles.choiceLetter,
                    borderColor: c.letter === selected ? "#60a5fa" : "#475569",
                  }}
                >
                  {c.letter}
                </span>
                <span>{c.text}</span>
              </div>
            );
          })}
        </div>

        {/* Explanation after confirm */}
        {confirmed && (
          <div style={styles.explanationBox}>
            <strong style={{ color: "#fbbf24" }}>Explanation:</strong> {q.explanation}
          </div>
        )}

        {/* Action buttons */}
        <div style={styles.navRow}>
          {!confirmed && !timedOut ? (
            <button
              style={{
                ...styles.primaryBtn,
                opacity: selected === null ? 0.4 : 1,
                cursor: selected === null ? "not-allowed" : "pointer",
              }}
              onClick={handleConfirm}
              disabled={selected === null}
            >
              Lock In Answer
            </button>
          ) : (
            <button style={styles.primaryBtn} onClick={handleNext}>
              {currentQ + 1 >= shuffledQuestions.length ? "See Results" : "Next Question →"}
            </button>
          )}
        </div>

        {/* Score ticker */}
        <div style={styles.scoreTicker}>
          {answers.map((a, i) => (
            <span
              key={i}
              style={{
                ...styles.tickerDot,
                backgroundColor: a.correct ? "#4ade80" : a.timedOut ? "#facc15" : "#ef4444",
              }}
              title={`Q${i + 1}: ${a.correct ? "Correct" : a.timedOut ? "Timed Out" : "Wrong"}`}
            />
          ))}
          {Array.from({ length: shuffledQuestions.length - answers.length }).map((_, i) => (
            <span key={`empty-${i}`} style={{ ...styles.tickerDot, backgroundColor: "#334155" }} />
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── STYLES ───
const styles = {
  container: {
    minHeight: "100vh",
    background: "linear-gradient(145deg, #0c0f1a 0%, #111827 40%, #0f172a 100%)",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    padding: 16,
    fontFamily: "'Georgia', 'Times New Roman', serif",
  },
  // Home
  homeCard: {
    background: "linear-gradient(160deg, #1a1f35 0%, #0f172a 100%)",
    border: "1px solid #2a3050",
    borderRadius: 16,
    padding: "48px 40px",
    maxWidth: 520,
    width: "100%",
    textAlign: "center",
    boxShadow: "0 0 80px rgba(59,130,246,0.08)",
    margin: "auto 0",
  },
  logoRow: { marginBottom: 8 },
  logoImg: { width: 120, height: "auto", borderRadius: 12 },
  title: {
    fontFamily: "'Georgia', serif",
    fontSize: 36,
    fontWeight: 700,
    color: "#f1f5f9",
    margin: "8px 0 0",
    letterSpacing: "-0.5px",
  },
  subtitle: {
    fontFamily: "'Georgia', serif",
    fontSize: 20,
    fontWeight: 400,
    color: "#fbbf24",
    margin: "4px 0 0",
    letterSpacing: "3px",
    textTransform: "uppercase",
  },
  tagline: {
    color: "#94a3b8",
    fontSize: 15,
    lineHeight: 1.6,
    margin: "20px 0 32px",
  },
  modeSection: { marginBottom: 24 },
  modeLabel: { color: "#64748b", fontSize: 13, marginBottom: 12, textTransform: "uppercase", letterSpacing: 1 },
  modeButtons: { display: "flex", gap: 12, justifyContent: "center" },
  modeBtn: {
    background: "transparent",
    border: "1px solid #334155",
    borderRadius: 12,
    padding: "16px 20px",
    cursor: "pointer",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: 4,
    flex: 1,
    transition: "all 0.2s",
  },
  modeBtnPrimary: {
    border: "2px solid #3b82f6",
    background: "#1e3a5f20",
  },
  modeNum: { fontSize: 28, fontWeight: 700, color: "#f1f5f9", fontFamily: "'Georgia', serif" },
  modeWord: { fontSize: 12, color: "#94a3b8", textTransform: "uppercase", letterSpacing: 1 },
  timerRow: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    marginBottom: 16,
  },
  timerLabel: {
    color: "#64748b",
    fontSize: 13,
    fontFamily: "sans-serif",
  },
  timerChip: {
    background: "transparent",
    border: "1px solid #334155",
    borderRadius: 16,
    padding: "4px 12px",
    cursor: "pointer",
    fontSize: 13,
    fontWeight: 600,
    color: "#64748b",
    fontFamily: "monospace",
    transition: "all 0.2s",
  },
  timerChipActive: {
    border: "1px solid #3b82f6",
    background: "#1e3a5f30",
    color: "#93c5fd",
  },
  playerCount: {
    color: "#64748b",
    fontSize: 13,
    marginBottom: 20,
    fontFamily: "sans-serif",
    letterSpacing: 0.5,
  },
  remainingText: {
    color: "#475569",
    fontSize: 12,
    marginTop: 10,
    fontFamily: "sans-serif",
  },
  allDoneBox: {
    background: "#0f172a",
    border: "1px solid #1e293b",
    borderRadius: 12,
    padding: "28px 24px",
    marginBottom: 20,
  },
  resetBtn: {
    padding: "10px 24px",
    background: "transparent",
    color: "#94a3b8",
    border: "1px solid #334155",
    borderRadius: 8,
    fontSize: 13,
    cursor: "pointer",
    fontFamily: "sans-serif",
    transition: "all 0.2s",
  },
  footer: { color: "#475569", fontSize: 13, marginTop: 8 },
  freeBadge: {
    display: "inline-block",
    background: "#065f46",
    color: "#6ee7b7",
    fontSize: 13,
    fontWeight: 600,
    padding: "4px 16px",
    borderRadius: 20,
    letterSpacing: 1,
    textTransform: "uppercase",
    marginBottom: 8,
    fontFamily: "sans-serif",
  },
  disclaimerText: {
    color: "#475569",
    fontSize: 12,
    marginTop: 16,
    fontFamily: "sans-serif",
  },
  link: {
    color: "#60a5fa",
    textDecoration: "none",
  },
  creatorRow: {
    marginTop: 16,
    color: "#64748b",
    fontSize: 13,
    fontFamily: "sans-serif",
  },

  // Game
  gameCard: {
    background: "linear-gradient(160deg, #1a1f35 0%, #0f172a 100%)",
    border: "1px solid #2a3050",
    borderRadius: 16,
    padding: "28px 32px 24px",
    maxWidth: 720,
    width: "100%",
    boxShadow: "0 0 80px rgba(59,130,246,0.08)",
    margin: "auto 0",
  },
  topBar: {
    display: "flex",
    alignItems: "center",
    gap: 12,
    marginBottom: 12,
    flexWrap: "wrap",
  },
  qCount: { color: "#64748b", fontSize: 14, fontFamily: "monospace" },
  typeBadge: {
    background: "#1e3a5f",
    color: "#60a5fa",
    fontSize: 12,
    padding: "4px 12px",
    borderRadius: 20,
    fontFamily: "sans-serif",
    fontWeight: 600,
    letterSpacing: 0.5,
  },
  streakBadge: {
    fontSize: 14,
    color: "#fbbf24",
    marginLeft: "auto",
    fontFamily: "sans-serif",
    fontWeight: 700,
  },
  timerTrack: {
    width: "100%",
    height: 4,
    background: "#1e293b",
    borderRadius: 2,
    overflow: "hidden",
    marginBottom: 4,
  },
  timerFill: {
    height: "100%",
    borderRadius: 2,
    transition: "width 1s linear, background-color 0.5s",
  },
  timerText: {
    color: "#64748b",
    fontSize: 12,
    textAlign: "right",
    marginBottom: 16,
    fontFamily: "monospace",
  },
  stimulus: {
    color: "#cbd5e1",
    fontSize: 15,
    lineHeight: 1.7,
    marginBottom: 16,
    padding: "16px 20px",
    background: "#0f172a",
    borderRadius: 10,
    border: "1px solid #1e293b",
    whiteSpace: "pre-wrap",
  },
  stem: {
    color: "#f1f5f9",
    fontSize: 15,
    fontWeight: 600,
    lineHeight: 1.5,
    marginBottom: 16,
    fontFamily: "sans-serif",
  },
  choices: { display: "flex", flexDirection: "column", gap: 10, marginBottom: 16 },
  choice: {
    display: "flex",
    alignItems: "flex-start",
    gap: 12,
    padding: "12px 16px",
    borderRadius: 10,
    fontSize: 14,
    lineHeight: 1.6,
    transition: "all 0.15s",
    fontFamily: "sans-serif",
  },
  choiceLetter: {
    minWidth: 28,
    height: 28,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    border: "1px solid #475569",
    borderRadius: 6,
    fontSize: 13,
    fontWeight: 700,
    flexShrink: 0,
    fontFamily: "monospace",
  },
  explanationBox: {
    background: "#1a1400",
    border: "1px solid #854d0e40",
    borderRadius: 10,
    padding: "14px 18px",
    fontSize: 14,
    color: "#fde68a",
    lineHeight: 1.6,
    marginBottom: 16,
    fontFamily: "sans-serif",
  },
  navRow: { display: "flex", gap: 12 },
  primaryBtn: {
    flex: 1,
    padding: "14px 24px",
    background: "linear-gradient(135deg, #2563eb, #3b82f6)",
    color: "#fff",
    border: "none",
    borderRadius: 10,
    fontSize: 15,
    fontWeight: 600,
    cursor: "pointer",
    fontFamily: "sans-serif",
    transition: "opacity 0.2s",
  },
  secondaryBtn: {
    padding: "14px 24px",
    background: "transparent",
    color: "#94a3b8",
    border: "1px solid #334155",
    borderRadius: 10,
    fontSize: 15,
    cursor: "pointer",
    fontFamily: "sans-serif",
  },
  scoreTicker: {
    display: "flex",
    gap: 6,
    justifyContent: "center",
    marginTop: 20,
    flexWrap: "wrap",
  },
  tickerDot: {
    width: 10,
    height: 10,
    borderRadius: "50%",
    display: "inline-block",
    transition: "background-color 0.3s",
  },
  // Results
  resultsCard: {
    background: "linear-gradient(160deg, #1a1f35 0%, #0f172a 100%)",
    border: "1px solid #2a3050",
    borderRadius: 16,
    padding: "48px 40px",
    maxWidth: 440,
    width: "100%",
    textAlign: "center",
    boxShadow: "0 0 80px rgba(59,130,246,0.08)",
    margin: "auto 0",
  },
  resultsTitle: {
    fontFamily: "'Georgia', serif",
    fontSize: 28,
    color: "#f1f5f9",
    margin: "12px 0",
  },
  scoreCircle: { margin: "20px 0 8px" },
  scoreBig: { fontSize: 64, fontWeight: 700, color: "#f1f5f9", fontFamily: "'Georgia', serif" },
  scoreSmall: { fontSize: 24, color: "#64748b", fontFamily: "'Georgia', serif" },
  resultsPct: { color: "#94a3b8", fontSize: 16, marginBottom: 24 },
  statsRow: { display: "flex", justifyContent: "center", gap: 32, marginBottom: 28 },
  statBox: { display: "flex", flexDirection: "column", alignItems: "center" },
  statNum: { fontSize: 24, fontWeight: 700, color: "#fbbf24", fontFamily: "'Georgia', serif" },
  statLabel: { fontSize: 12, color: "#64748b", textTransform: "uppercase", letterSpacing: 1 },
  reviewBtn: {
    width: "100%",
    padding: "14px 24px",
    background: "transparent",
    color: "#94a3b8",
    border: "1px solid #334155",
    borderRadius: 10,
    fontSize: 15,
    cursor: "pointer",
    fontFamily: "sans-serif",
  },
  // Leaderboard
  lbLink: {
    background: "transparent",
    border: "1px solid #334155",
    borderRadius: 10,
    padding: "10px 20px",
    color: "#fbbf24",
    fontSize: 14,
    fontWeight: 600,
    cursor: "pointer",
    fontFamily: "sans-serif",
    marginTop: 16,
    transition: "all 0.2s",
  },
  lbSubmitBox: {
    background: "#0f172a",
    border: "1px solid #1e293b",
    borderRadius: 10,
    padding: "14px 16px",
    marginBottom: 16,
  },
  lbInput: {
    flex: 1,
    padding: "10px 12px",
    background: "#1e293b",
    border: "1px solid #334155",
    borderRadius: 8,
    color: "#f1f5f9",
    fontSize: 14,
    fontFamily: "sans-serif",
    outline: "none",
  },
  lbSubmitBtn: {
    padding: "10px 18px",
    background: "linear-gradient(135deg, #2563eb, #3b82f6)",
    color: "#fff",
    border: "none",
    borderRadius: 8,
    fontSize: 14,
    fontWeight: 600,
    cursor: "pointer",
    fontFamily: "sans-serif",
    whiteSpace: "nowrap",
  },
  lbTitle: {
    fontFamily: "'Georgia', serif",
    fontSize: 28,
    color: "#f1f5f9",
    marginBottom: 4,
  },
  lbSubtitle: {
    color: "#64748b",
    fontSize: 13,
    marginBottom: 20,
    fontFamily: "sans-serif",
  },
  lbTable: {
    width: "100%",
    marginTop: 8,
  },
  lbHeaderRow: {
    display: "flex",
    alignItems: "center",
    padding: "8px 8px",
    borderBottom: "1px solid #1e293b",
    marginBottom: 4,
  },
  lbHeaderCell: {
    color: "#475569",
    fontSize: 11,
    fontWeight: 600,
    textTransform: "uppercase",
    letterSpacing: 1,
    fontFamily: "sans-serif",
    textAlign: "center",
  },
  lbRow: {
    display: "flex",
    alignItems: "center",
    padding: "8px 8px",
    borderRadius: 8,
    transition: "background 0.15s",
  },
  lbRowYou: {
    background: "#1e3a5f20",
    border: "1px solid #2563eb40",
  },
  lbCell: {
    fontSize: 13,
    fontFamily: "sans-serif",
    textAlign: "center",
  },
};
