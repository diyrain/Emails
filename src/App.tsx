/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useMemo, useRef } from 'react';
import { 
  PenLine, 
  Inbox, 
  Settings, 
  Download, 
  Upload, 
  Trash2, 
  ChevronLeft, 
  Plus, 
  Calendar,
  Save,
  Share2,
  BookOpen,
  Smile,
  CloudSun,
  User as UserIcon,
  LogOut,
  CloudRain
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { Letter } from './types.ts';
import { 
  auth, 
  db, 
  googleProvider, 
  signInWithPopup, 
  signOut, 
  onAuthStateChanged, 
  collection, 
  doc, 
  setDoc, 
  getDocs, 
  query, 
  where, 
  orderBy, 
  deleteDoc, 
  updateDoc, 
  writeBatch,
  User
} from './lib/firebase';

const STORAGE_KEY = 'time-capsule-letters-data';

const MOODS = ['😊', '😢', '😠', '😴', '🤩', '🫠', '😐', '🌱', '☕'];
const WEATHERS = ['☀️', '☁️', '🌧️', '❄️', '💨', '🌩️', '🌫️'];

export default function App() {
  const [letters, setLetters] = useState<Letter[]>([]);
  const [activeView, setActiveView] = useState<'dashboard' | 'write' | 'archives' | 'settings'>('dashboard');
  const [editingLetter, setEditingLetter] = useState<Letter | null>(null);
  const [viewingLetter, setViewingLetter] = useState<Letter | null>(null);
  const [isLoaded, setIsLoaded] = useState(false);
  const [user, setUser] = useState<User | null>(null);
  const [isSyncing, setIsSyncing] = useState(false);
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  const [appTitle, setAppTitle] = useState('和t的档案室');

  const [selectedMood, setSelectedMood] = useState<string>('');
  const [selectedWeather, setSelectedWeather] = useState<string>('');

  // Auth & Data Sync
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (u) => {
      setUser(u);
      if (u) {
        // Fetch letters from Firestore
        await fetchCloudLetters(u.uid);
      } else {
        // Load local only if not logged in
        const saved = localStorage.getItem(STORAGE_KEY);
        if (saved) {
          try {
            setLetters(JSON.parse(saved));
          } catch (e) {
            console.error('Failed to parse saved letters', e);
          }
        }
      }
      setIsLoaded(true);
    });
    return () => unsubscribe();
  }, []);

  const fetchCloudLetters = async (uid: string) => {
    setIsSyncing(true);
    try {
      const q = query(collection(db, 'letters'), where('authorId', '==', uid), orderBy('createdAt', 'desc'));
      const querySnapshot = await getDocs(q);
      const cloudLetters = querySnapshot.docs.map(doc => doc.data() as Letter);
      setLetters(cloudLetters);
      
      // Optionally sync local to cloud for the first time
      const localSaved = localStorage.getItem(STORAGE_KEY);
      if (localSaved) {
        const localLetters = JSON.parse(localSaved) as Letter[];
        if (localLetters.length > 0 && cloudLetters.length === 0) {
          if (confirm('发现本地有信件但云端为空，是否将本地信件同步至云端？')) {
            await syncLocalTasksToCloud(uid, localLetters);
          }
        }
      }
    } catch (e) {
      console.error('Failed to fetch from cloud', e);
    } finally {
      setIsSyncing(false);
    }
  };

  const syncLocalTasksToCloud = async (uid: string, localItems: Letter[]) => {
    const batch = writeBatch(db);
    localItems.forEach(item => {
      const docRef = doc(db, 'letters', item.id);
      batch.set(docRef, { ...item, authorId: uid });
    });
    await batch.commit();
    localStorage.removeItem(STORAGE_KEY); // Clear local after successful sync
    await fetchCloudLetters(uid);
  };

  const handleLogin = async () => {
    try {
      await signInWithPopup(auth, googleProvider);
    } catch (e) {
      console.error('Login failed', e);
    }
  };

  const handleLogout = async () => {
    try {
      await signOut(auth);
      setLetters([]);
      localStorage.removeItem(STORAGE_KEY);
    } catch (e) {
      console.error('Logout failed', e);
    }
  };

  // Stats
  const stats = useMemo(() => {
    if (letters.length === 0) return { days: 0, count: 0 };
    const dates = letters.map(l => new Date(l.createdAt).toDateString());
    const uniqueDates = new Set(dates);
    
    // Total days: either count unique writing days or days since first letter
    const firstLetter = [...letters].sort((a, b) => a.createdAt - b.createdAt)[0];
    const diffTime = Math.abs(Date.now() - firstLetter.createdAt);
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    
    return {
      days: diffDays || 1,
      writingDays: uniqueDates.size,
      count: letters.length
    };
  }, [letters]);

  // Actions
  const saveLetter = async (l: Partial<Letter>) => {
    const now = Date.now();
    let updatedItem: Letter;

    if (editingLetter) {
      updatedItem = { 
        ...editingLetter, 
        ...l, 
        updatedAt: now 
      } as Letter;
      setLetters(prev => prev.map(item => item.id === editingLetter.id ? updatedItem : item));
      
      if (user) {
        await updateDoc(doc(db, 'letters', editingLetter.id), { ...l, updatedAt: now });
      }
    } else {
      updatedItem = {
        id: crypto.randomUUID(),
        title: l.title || '无题',
        recipient: l.recipient || '致未来的自己',
        content: l.content || '',
        createdAt: now,
        updatedAt: now,
        mood: l.mood || '',
        weather: l.weather || '',
        authorId: user?.uid
      };
      setLetters(prev => [updatedItem, ...prev]);

      if (user) {
        await setDoc(doc(db, 'letters', updatedItem.id), updatedItem);
      }
    }

    if (!user) {
      // Manual save to local for non-auth
      localStorage.setItem(STORAGE_KEY, JSON.stringify([updatedItem, ...letters.filter(item => item.id !== updatedItem.id)]));
    }

    setActiveView('archives');
    setEditingLetter(null);
    setSelectedMood('');
    setSelectedWeather('');
  };

  const deleteLetter = async (id: string) => {
    // This is now the actual deletion after confirmation
    setLetters(prev => {
      const filtered = prev.filter(l => l.id !== id);
      if (!user) {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(filtered));
      }
      return filtered;
    });

    if (viewingLetter?.id === id) setViewingLetter(null);
    setPendingDeleteId(null);
    
    if (user) {
      try {
        await deleteDoc(doc(db, 'letters', id));
      } catch (e) {
        console.error('Error deleting document: ', e);
        alert('云端删除失败，请检查网络连接');
      }
    }
  };

  const confirmDelete = (id: string) => {
    setPendingDeleteId(id);
  };

  const exportData = () => {
    const dataStr = JSON.stringify(letters, null, 2);
    const blob = new Blob([dataStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `time-capsule-letters-${new Date().toISOString().split('T')[0]}.json`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const importData = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const imported = JSON.parse(event.target?.result as string);
        if (Array.isArray(imported)) {
          if (confirm(`准备导入 ${imported.length} 封信件，是否覆盖当前数据？`)) {
            setLetters(imported);
          }
        }
      } catch (e) {
        alert('导入失败：文件格式不正确');
      }
    };
    reader.readAsText(file);
  };

  // Views
  if (!isLoaded) return <div className="h-screen flex items-center justify-center font-serif">开启卷轴中...</div>;

  return (
    <div className="min-h-screen flex flex-col md:h-screen md:overflow-hidden bg-paper">
      {/* Header - Fixed height Editorial Style */}
      <header className="h-[100px] px-6 md:px-10 flex items-center justify-between border-b border-ink/10 shrink-0">
        <div 
          onClick={() => setActiveView('dashboard')}
          className="text-xl md:text-2xl font-bold tracking-[0.2em] uppercase text-ink cursor-pointer hover:opacity-70 transition-opacity"
        >
          {appTitle}
        </div>
        
        <div className="flex items-center gap-6">
          {user ? (
            <div className="hidden md:flex items-center gap-4 border-r border-ink/10 pr-6 mr-6">
              <div className="text-right">
                <span className="block text-[10px] font-sans uppercase tracking-widest text-accent font-bold">{user.displayName}</span>
                <span className="text-[9px] font-sans text-ink/40 uppercase tracking-tighter">云端已同步</span>
              </div>
              {user.photoURL && (
                <img src={user.photoURL} referrerPolicy="no-referrer" alt="" className="w-8 h-8 rounded-full border border-ink/10" />
              )}
            </div>
          ) : (
            <button 
              onClick={handleLogin}
              className="hidden md:flex items-center gap-2 text-[10px] font-sans uppercase tracking-[0.2em] text-accent hover:text-ink transition-colors mr-6"
            >
              <UserIcon size={14} /> 登录同步
            </button>
          )}

          <div className="text-right">
            <span className="block text-2xl md:text-3xl italic font-serif text-accent leading-none">{stats.days}</span>
            <span className="text-[10px] font-sans uppercase tracking-widest text-ink/60">Days of Writing</span>
          </div>
        </div>
      </header>

      <div className="flex-1 flex flex-col md:flex-row md:overflow-hidden">
        {/* Sidebar - Desktop Only */}
        <aside className="hidden md:flex w-[320px] border-r border-ink/10 bg-white/30 flex-col py-8 px-10 shrink-0 overflow-y-auto">
          <div className="mb-10">
            <button 
              onClick={() => {
                setEditingLetter(null);
                setActiveView('write');
              }}
              className="w-full py-3 border border-ink bg-ink text-white font-sans text-xs uppercase tracking-widest hover:bg-transparent hover:text-ink transition-all active:scale-95"
            >
              新建信笺
            </button>
          </div>

          <div className="mb-10">
            <h2 className="font-sans text-[11px] font-semibold uppercase tracking-[0.15em] text-accent mb-6">过往信件回顾</h2>
            <div className="space-y-4 max-h-[300px] overflow-y-auto pr-2 scrollbar-thin">
              {letters.slice(0, 8).map(l => (
                <div 
                  key={l.id} 
                  onClick={() => setViewingLetter(l)}
                  className="group cursor-pointer"
                >
                  <span className="block font-sans text-[10px] opacity-40 mb-1 group-hover:opacity-60 transition-opacity">
                    {new Date(l.createdAt).toLocaleDateString()}
                  </span>
                  <div className={`text-sm truncate font-serif transition-all ${viewingLetter?.id === l.id ? 'text-accent underline underline-offset-4' : 'text-ink group-hover:text-accent'}`}>
                    {l.title}
                  </div>
                </div>
              ))}
              {letters.length > 8 && (
                <button 
                  onClick={() => setActiveView('archives')}
                  className="text-[10px] font-sans uppercase tracking-widest text-accent hover:underline mt-2"
                >
                  查看全部...
                </button>
              )}
            </div>
          </div>

          <div className="mt-auto pt-6 border-t border-ink/10">
            {user ? (
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <h2 className="font-sans text-[11px] font-semibold uppercase tracking-[0.15em] text-accent">云端账户</h2>
                  <button onClick={handleLogout} className="text-[10px] font-sans opacity-40 hover:opacity-100 hover:text-red-800 transition-all flex items-center gap-1">
                    退出 <LogOut size={10} />
                  </button>
                </div>
                <div className="p-4 bg-paper/50 border border-ink/5 rounded-sm">
                  <p className="text-[10px] font-sans opacity-60 leading-relaxed">
                    你的所有数据现在已安全存储于云端。无论在任何设备登录，都将即时同步。
                  </p>
                </div>
              </div>
            ) : (
              <div className="space-y-4">
                <h2 className="font-sans text-[11px] font-semibold uppercase tracking-[0.15em] text-accent">数据同步</h2>
                <p className="text-[10px] font-sans opacity-40 leading-relaxed mb-4">登录以开启云端同步，防止数据丢失。</p>
                <button 
                  onClick={handleLogin}
                  className="w-full py-3 border border-accent text-accent font-sans text-[10px] uppercase tracking-widest hover:bg-accent hover:text-white transition-all"
                >
                  签署同步协议 (Google)
                </button>
              </div>
            )}
          </div>
        </aside>

        {/* Main Workspace */}
        <main className="flex-1 overflow-y-auto md:p-10 lg:p-16 relative">
          {/* Mobile Back Button Replacement */}
          {activeView !== 'dashboard' && (
            <button 
              onClick={() => {
                setActiveView('dashboard');
                setEditingLetter(null);
                setViewingLetter(null);
              }}
              className="md:hidden absolute top-4 left-4 p-2 text-ink/60 active:scale-95"
            >
              <ChevronLeft size={24} />
            </button>
          )}

          <AnimatePresence mode="wait">
            {activeView === 'dashboard' && (
              <motion.div
                key="dashboard"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="max-w-2xl mx-auto md:mx-0 p-6 md:p-0 space-y-12"
              >
                <div className="space-y-2">
                  <h2 className="text-4xl md:text-5xl font-bold font-serif italic text-ink">和t的档案室</h2>
                </div>

                <div className="grid grid-cols-2 gap-px bg-ink/10 border border-ink/10">
                  <div className="p-8 md:p-12 bg-white flex flex-col items-center">
                    <span className="text-5xl md:text-6xl italic font-serif text-accent">{stats.days}</span>
                    <span className="font-sans text-[10px] uppercase tracking-widest opacity-40 mt-4">记录周期</span>
                  </div>
                  <div className="p-8 md:p-12 bg-white flex flex-col items-center">
                    <span className="text-5xl md:text-6xl italic font-serif text-ink">{stats.count}</span>
                    <span className="font-sans text-[10px] uppercase tracking-widest opacity-40 mt-4">书信总目</span>
                  </div>
                </div>

                <div className="md:hidden space-y-4 pt-8">
                  <button 
                    onClick={() => setActiveView('write')}
                    className="w-full py-5 bg-ink text-white font-sans text-xs uppercase tracking-widest"
                  >
                    新建信笺
                  </button>
                  <button 
                    onClick={() => setActiveView('archives')}
                    className="w-full py-5 border border-ink text-ink font-sans text-xs uppercase tracking-widest"
                  >
                    书信往昔
                  </button>
                  <button 
                    onClick={() => setActiveView('settings')}
                    className="w-full py-3 opacity-60 font-sans text-[10px] uppercase tracking-widest"
                  >
                    系统配置
                  </button>
                </div>

                <div className="hidden md:block pt-12 max-w-lg">
                </div>
              </motion.div>
            )}

            {activeView === 'write' && (
              <motion.div
                key="write"
                initial={{ opacity: 0, scale: 0.98 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0 }}
                className="max-w-3xl mx-auto min-h-[80vh] md:h-full p-4 md:p-0 overflow-y-auto"
              >
                <div className="editorial-shadow bg-white border border-ink/5 p-8 md:p-20 md:pt-12 flex flex-col min-h-full">
                  {/* Letter Header/Meta */}
                  <div className="space-y-4 mb-12">
                    <div className="flex border-b border-ink/5 py-4 items-baseline">
                      <span className="font-serif text-4xl italic text-accent w-20 shrink-0">致</span>
                      <input 
                        type="text" 
                        placeholder="未来的自己"
                        className="flex-1 font-serif text-2xl outline-none bg-transparent placeholder:opacity-10"
                        defaultValue={editingLetter?.recipient}
                        id="recipient"
                      />
                    </div>
                    <div className="flex border-b border-ink/5 py-4 items-baseline">
                      <span className="font-serif text-4xl italic text-accent w-20 shrink-0">标</span>
                      <input 
                        type="text" 
                        placeholder="给时光的一封信"
                        className="flex-1 font-serif text-2xl outline-none bg-transparent placeholder:opacity-10"
                        defaultValue={editingLetter?.title}
                        id="title"
                      />
                    </div>
                  </div>

                  {/* Mood & Weather - More compact */}
                  <div className="flex flex-col md:flex-row gap-8 mb-6 opacity-60 hover:opacity-100 transition-opacity">
                    <div className="space-y-2">
                      <span className="block font-sans text-[8px] uppercase tracking-[0.2em] text-accent">心绪</span>
                      <div className="flex gap-1.5">
                        {MOODS.map(m => (
                          <button 
                            key={m}
                            onClick={() => setSelectedMood(selectedMood === m ? '' : m)}
                            className={`w-7 h-7 rounded-sm border border-ink/5 flex items-center justify-center text-sm transition-all ${selectedMood === m ? 'bg-ink text-white ring-2 ring-accent/20' : 'bg-transparent grayscale opacity-50 hover:opacity-100'}`}
                          >
                            {m}
                          </button>
                        ))}
                      </div>
                    </div>
                    <div className="space-y-2">
                      <span className="block font-sans text-[8px] uppercase tracking-[0.2em] text-accent">气象</span>
                      <div className="flex gap-1.5">
                        {WEATHERS.map(w => (
                          <button 
                            key={w}
                            onClick={() => setSelectedWeather(selectedWeather === w ? '' : w)}
                            className={`w-7 h-7 rounded-sm border border-ink/5 flex items-center justify-center text-sm transition-all ${selectedWeather === w ? 'bg-ink text-white ring-2 ring-accent/20' : 'bg-transparent grayscale opacity-50 hover:opacity-100'}`}
                          >
                            {w}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>

                  {/* Typing area with intentionally large whitespace above it (mt-2) */}
                  <textarea 
                    placeholder="于此，静候灵感降临..."
                    className="flex-1 w-full min-h-[400px] font-serif text-xl leading-[2.2] border-none resize-none outline-none text-ink placeholder:opacity-10 mt-2"
                    defaultValue={editingLetter?.content}
                    id="content"
                  />

                  <div className="mt-20 pt-10 border-t border-ink/5 flex justify-between items-center bg-transparent shrink-0">
                    <button 
                      onClick={() => {
                        setActiveView('dashboard');
                        setSelectedMood('');
                        setSelectedWeather('');
                      }}
                      className="font-sans text-[9px] uppercase tracking-widest opacity-30 hover:opacity-100 transition-opacity"
                    >
                      舍弃草稿
                    </button>
                    <button 
                      onClick={() => {
                        const title = (document.getElementById('title') as HTMLInputElement).value;
                        const recipient = (document.getElementById('recipient') as HTMLInputElement).value;
                        const content = (document.getElementById('content') as HTMLTextAreaElement).value;
                        saveLetter({ 
                          title, 
                          recipient, 
                          content, 
                          mood: selectedMood, 
                          weather: selectedWeather 
                        });
                      }}
                      className="px-12 py-3 bg-ink text-white font-sans text-xs uppercase tracking-widest hover:bg-accent transition-all active:scale-95"
                    >
                      封缄存证
                    </button>
                  </div>
                </div>
              </motion.div>
            )}

            {(activeView === 'archives' || activeView === 'settings') && (
              <motion.div
                key="archives-view"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="max-w-3xl mx-auto p-6 md:p-0"
              >
                {activeView === 'archives' ? (
                  <div className="space-y-12">
                    <h2 className="text-4xl font-serif italic text-ink border-b border-ink pb-4">和t的档案室</h2>
                    {letters.length === 0 ? (
                      <div className="py-20 text-center opacity-30 font-serif italic">尚无书信档案...</div>
                    ) : (
                      <div className="grid md:grid-cols-2 gap-8">
                        {letters.map(letter => (
                          <div 
                            key={letter.id}
                            onClick={() => setViewingLetter(letter)}
                            className="bg-white p-8 editorial-shadow border border-ink/5 group cursor-pointer hover:-translate-y-1 items-start transition-all"
                          >
                            <span className="block font-sans text-[10px] uppercase tracking-widest opacity-40 mb-3">
                              {new Date(letter.createdAt).toLocaleDateString()}
                              {(letter.mood || letter.weather) && (
                                <span className="ml-2 inline-flex gap-2">
                                  {letter.mood && <span>{letter.mood}</span>}
                                  {letter.weather && <span>{letter.weather}</span>}
                                </span>
                              )}
                            </span>
                            <h3 className="text-xl font-serif font-bold text-ink mb-3 group-hover:text-accent transition-colors">{letter.title}</h3>
                            <p className="text-sm line-clamp-3 text-ink/60 mb-6 font-serif leading-relaxed italic">
                              "{letter.content}"
                            </p>
                            <div className="flex justify-between items-center text-[10px] font-sans uppercase tracking-[0.2em] text-accent">
                              <span>致：{letter.recipient}</span>
                              <div className="flex gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                                <button 
                                  onClick={(e) => { 
                                    e.stopPropagation(); 
                                    setEditingLetter(letter); 
                                    setSelectedMood(letter.mood || '');
                                    setSelectedWeather(letter.weather || '');
                                    setActiveView('write'); 
                                  }}
                                  className="hover:underline"
                                >
                                  修改
                                </button>
                                <button 
                                  onClick={(e) => { e.stopPropagation(); confirmDelete(letter.id); }}
                                  className="text-red-800 hover:underline"
                                >
                                  销毁
                                </button>
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="space-y-12">
                    <h2 className="text-4xl font-serif italic text-ink border-b border-ink pb-4">系统设置</h2>
                    <div className="bg-white p-12 editorial-shadow border border-ink/5 space-y-10">
                      <section>
                        <h3 className="font-sans text-xs uppercase tracking-[0.2em] text-accent mb-6">同步与备份</h3>
                        <div className="grid gap-4">
                          <button onClick={exportData} className="w-full py-4 border border-ink text-ink font-sans text-xs uppercase tracking-widest hover:bg-ink hover:text-white transition-all">导出离线档案 (.json)</button>
                          <label className="w-full py-4 border border-accent/20 border-dashed text-accent font-sans text-xs uppercase tracking-widest text-center cursor-pointer hover:border-accent transition-all">
                            导入现存档案
                            <input type="file" accept=".json" onChange={importData} className="hidden" />
                          </label>
                        </div>
                      </section>
                      <section className="pt-10 border-t border-ink/10">
                        <button 
                          onClick={() => { if(window.confirm('从此页面销毁所有数据？')) { setLetters([]); localStorage.removeItem(STORAGE_KEY); } }}
                          className="text-red-800 font-sans text-[10px] uppercase tracking-widest hover:underline"
                        >
                          摧毁全部本地数据
                        </button>
                      </section>
                    </div>
                  </div>
                )}
              </motion.div>
            )}
          </AnimatePresence>
        </main>
      </div>

      {/* Reader View Overlay - Styled like the Editorial Editor */}
      <AnimatePresence>
        {viewingLetter && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-paper/95 backdrop-blur-sm p-4 md:p-10"
            onClick={() => setViewingLetter(null)}
          >
            <motion.div 
              initial={{ scale: 0.9, y: 30 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.9, y: 30 }}
              className="bg-white paper-texture editorial-shadow w-full max-w-2xl max-h-full overflow-y-auto p-10 md:p-20 relative border border-ink/5"
              onClick={e => e.stopPropagation()}
            >
              <button 
                onClick={() => setViewingLetter(null)}
                className="absolute top-8 right-8 text-ink/30 hover:text-ink transition-colors"
              >
                <Plus size={32} className="rotate-45" />
              </button>
              
              <div className="mb-16 border-b border-ink/10 pb-10">
                <span className="font-sans text-[10px] font-bold uppercase tracking-widest text-accent block mb-6">
                  {new Date(viewingLetter.createdAt).toLocaleDateString()} • {new Date(viewingLetter.createdAt).toLocaleDateString('zh-CN', { weekday: 'long' })}
                  {(viewingLetter.mood || viewingLetter.weather) && (
                    <span className="ml-4 inline-flex gap-3">
                      {viewingLetter.mood && <span title="心情">{viewingLetter.mood}</span>}
                      {viewingLetter.weather && <span title="天气">{viewingLetter.weather}</span>}
                    </span>
                  )}
                </span>
                <h2 className="text-4xl md:text-5xl font-serif font-bold italic text-ink mb-6">{viewingLetter.title}</h2>
                <div className="font-serif italic text-accent opacity-80">
                  致：{viewingLetter.recipient}
                </div>
              </div>

              <div className="font-serif leading-[2.2] text-xl text-ink/80 whitespace-pre-wrap min-h-[400px]">
                {viewingLetter.content}
              </div>

              <div className="mt-20 pt-10 border-t border-ink/10 flex justify-between items-center font-sans text-[10px] uppercase tracking-widest text-ink/30">
                <div className="flex gap-6">
                  <button className="hover:text-ink transition-colors" onClick={(e) => { e.stopPropagation(); }}>分享此页</button>
                  <button className="hover:text-ink transition-colors" onClick={(e) => { e.stopPropagation(); setViewingLetter(null); setEditingLetter(viewingLetter); setActiveView('write'); }}>编辑此篇</button>
                  <button 
                    className="text-red-800/60 hover:text-red-800 transition-colors uppercase tracking-widest font-sans" 
                    onClick={(e) => { 
                      e.stopPropagation(); 
                      if (viewingLetter) confirmDelete(viewingLetter.id); 
                    }}
                  >
                    删除此篇
                  </button>
                </div>
                <div className="italic font-serif normal-case opacity-40">岁月无声，字迹有痕。</div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Floating Action Hint - Static & Subtle */}
      <div className="fixed bottom-6 right-6 md:hidden">
        <button 
          onClick={() => setActiveView('write')}
          className="w-14 h-14 bg-ink text-white rounded-full flex items-center justify-center editorial-shadow transition-transform active:scale-90"
        >
          <Plus size={24} />
        </button>
      </div>
      {/* Confirmation Modal */}
      <AnimatePresence>
        {pendingDeleteId && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[100] flex items-center justify-center bg-paper/60 backdrop-blur-md p-4"
          >
            <motion.div 
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="bg-white p-10 md:p-16 border border-ink/10 editorial-shadow max-w-md w-full text-center"
            >
              <h3 className="font-serif text-3xl italic text-ink mb-6">确认删除？</h3>
              <p className="font-serif text-ink/60 mb-10 leading-relaxed">
                此封信件将被永久抹去，文字无法追回。你确定要删除此篇信件吗？
              </p>
              <div className="flex flex-col gap-4">
                <button 
                  onClick={() => deleteLetter(pendingDeleteId)}
                  className="w-full py-4 bg-red-900 text-white font-sans text-xs uppercase tracking-[0.2em] hover:bg-red-800 transition-all"
                >
                  确认删除
                </button>
                <button 
                  onClick={() => setPendingDeleteId(null)}
                  className="w-full py-4 border border-ink/10 font-sans text-xs uppercase tracking-[0.2em] hover:bg-paper transition-all"
                >
                  保留此篇
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
