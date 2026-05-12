'use client'

import { useEffect, useState, useCallback, useRef } from 'react'
import { useParams } from 'next/navigation'
import ReactMarkdown from 'react-markdown'
import {
  CalendarDays, ChevronLeft, ChevronRight, Loader2, Sparkles, X, Check,
  Plus, Clock, Pencil, Trash2, Image as ImageIcon, Video, FileText, Upload, ExternalLink, Eye, Code2,
} from 'lucide-react'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import { api } from '@/lib/api'
import { useAppStore } from '@/stores/app-store'
import { SidebarToggle } from '@/components/layout/sidebar'
import { BackButton } from '@/components/layout/back-button'
import type { CalendarEntry } from '@/types'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MONTH_NAMES = ['January','February','March','April','May','June','July','August','September','October','November','December']
const PLATFORMS   = ['Instagram','Facebook','TikTok','LinkedIn','X','Email']
const STATUSES    = ['planned','drafted','approved','scheduled','posted']

// Content types grouped by their primary input mode
const CONTENT_TYPES = ['Post','Image','Video','Blog','Carousel','Story','Reel']
const VIDEO_TYPES   = new Set(['video','story','reel'])

const TYPE_FORMAT_MAP: Record<string,string> = {
  Post:'post', Image:'post', Video:'reel', Blog:'post', Carousel:'carousel', Story:'story', Reel:'reel',
}

const PLATFORM_DOT: Record<string,string> = {
  Instagram:'bg-pink-500', Facebook:'bg-blue-600', TikTok:'bg-slate-700',
  LinkedIn:'bg-sky-700', X:'bg-slate-600', Email:'bg-orange-500',
}
const PLATFORM_PILL: Record<string,string> = {
  Instagram:'bg-pink-500/10 border-l-2 border-pink-500 text-pink-700 dark:text-pink-400',
  Facebook: 'bg-blue-600/10 border-l-2 border-blue-600 text-blue-700 dark:text-blue-400',
  TikTok:   'bg-slate-700/10 border-l-2 border-slate-600 text-slate-700 dark:text-slate-300',
  LinkedIn: 'bg-sky-700/10 border-l-2 border-sky-700 text-sky-700 dark:text-sky-400',
  X:        'bg-slate-600/10 border-l-2 border-slate-500 text-slate-600 dark:text-slate-400',
  Email:    'bg-orange-500/10 border-l-2 border-orange-500 text-orange-700 dark:text-orange-400',
}
const PLATFORM_BADGE: Record<string,string> = {
  Instagram:'bg-pink-500/15 text-pink-700 dark:text-pink-300',
  Facebook: 'bg-blue-600/15 text-blue-700 dark:text-blue-300',
  TikTok:   'bg-slate-700/15 text-slate-700 dark:text-slate-300',
  LinkedIn: 'bg-sky-700/15 text-sky-700 dark:text-sky-300',
  X:        'bg-slate-600/15 text-slate-600 dark:text-slate-300',
  Email:    'bg-orange-500/15 text-orange-700 dark:text-orange-300',
}
const STATUS_DOT: Record<string,string> = {
  planned:'bg-muted-foreground/40', drafted:'bg-blue-500',
  approved:'bg-green-500', scheduled:'bg-amber-500', posted:'bg-purple-500',
}
const STATUS_PILL: Record<string,string> = {
  planned:'bg-muted text-muted-foreground', drafted:'bg-blue-500/10 text-blue-600',
  approved:'bg-green-500/10 text-green-600', scheduled:'bg-amber-500/10 text-amber-600',
  posted:'bg-purple-500/10 text-purple-600',
}
const PLATFORM_ABBR: Record<string,string> = {
  Instagram:'IG', Facebook:'FB', TikTok:'TT', LinkedIn:'LI', X:'X', Email:'EM',
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const daysInMonth = (y:number,m:number) => new Date(y,m+1,0).getDate()
const firstDayOfMonth = (y:number,m:number) => new Date(y,m,1).getDay()
const formatDate = (d:string) => new Date(d+'T00:00:00').toLocaleDateString('en-GB',{weekday:'long',day:'numeric',month:'long'})
const parseHashtags = (raw:string) => raw.split(/[\s,]+/).map(t=>t.replace(/^#/,'').trim()).filter(Boolean)


// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function CalendarPage() {
  const params = useParams<{projectId:string}>()
  const { activeProject, calendarCache, setCalendarCache, invalidateCalendarCache } = useAppStore()

  const today = new Date()
  const [year,setYear]   = useState(today.getFullYear())
  const [month,setMonth] = useState(today.getMonth())
  const [entries,setEntries]               = useState<CalendarEntry[]>([])
  const [loading,setLoading]               = useState(true)
  const [generating,setGenerating]         = useState(false)
  const [selectedEntry,setSelectedEntry]   = useState<CalendarEntry|null>(null)
  const [showGenerateForm,setShowGenerateForm] = useState(false)
  const [addDate,setAddDate]               = useState<string|null>(null)
  const [overflowDay,setOverflowDay]       = useState<string|null>(null)

  const cacheKey = `${params.projectId}-${year}-${String(month+1).padStart(2,'0')}`

  const loadEntries = useCallback(async (silent=false) => {
    if (!silent) setLoading(true)
    try {
      const start   = `${year}-${String(month+1).padStart(2,'0')}-01`
      const lastDay = daysInMonth(year,month)
      const end     = `${year}-${String(month+1).padStart(2,'0')}-${lastDay}`
      const data    = await api.calendar.get(params.projectId, start, end)
      setEntries(data.entries)
      setCalendarCache(cacheKey, data.entries)
    } catch(e){console.error(e)}
    finally { if (!silent) setLoading(false) }
  },[params.projectId,year,month,cacheKey,setCalendarCache])

  useEffect(()=>{
    const cached = calendarCache[cacheKey]
    if (cached){setEntries(cached);setLoading(false);loadEntries(true)}
    else loadEntries(false)
    setSelectedEntry(null); setOverflowDay(null)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  },[cacheKey])

  function prevMonth(){if(month===0){setYear(y=>y-1);setMonth(11)}else setMonth(m=>m-1)}
  function nextMonth(){if(month===11){setYear(y=>y+1);setMonth(0)}else setMonth(m=>m+1)}

  const days=daysInMonth(year,month), startDay=firstDayOfMonth(year,month)
  const byDate: Record<string,CalendarEntry[]> = {}
  for(const e of entries){ if(!byDate[e.date]) byDate[e.date]=[]; byDate[e.date].push(e) }
  const presentPlatforms = Array.from(new Set(entries.map(e=>e.platform))).filter(p=>PLATFORM_DOT[p])

  function sync(next: CalendarEntry[]){
    const s=[...next].sort((a,b)=>a.date.localeCompare(b.date))
    setEntries(s); setCalendarCache(cacheKey,s)
  }

  function handleAdded(created: CalendarEntry[]){ sync([...entries,...created]); setAddDate(null) }

  async function handleStatusChange(entry: CalendarEntry, status: string){
    try {
      await api.calendar.updateEntry(params.projectId, entry.id, {status})
      const next=entries.map(e=>e.id===entry.id?{...e,status}:e); sync(next)
      setSelectedEntry(e=>e?.id===entry.id?{...e,status}:e)
    } catch { toast.error('Failed to update status') }
  }

  async function handleSave(entry: CalendarEntry, updates: Partial<CalendarEntry>){
    try {
      const updated = await api.calendar.updateEntry(params.projectId, entry.id, updates)
      sync(entries.map(e=>e.id===entry.id?updated:e))
      setSelectedEntry(updated); toast.success('Saved')
    } catch { toast.error('Failed to save') }
  }

  async function handleDelete(entry: CalendarEntry){
    try {
      await api.calendar.deleteEntry(params.projectId, entry.id)
      sync(entries.filter(e=>e.id!==entry.id))
      setSelectedEntry(null); toast.success('Entry removed')
    } catch { toast.error('Failed to delete') }
  }

  return (
    <div className="flex flex-col flex-1 overflow-hidden" onClick={()=>setOverflowDay(null)}>
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-border shrink-0">
        <SidebarToggle/><BackButton/>
        <CalendarDays className="w-4 h-4 text-primary"/>
        <span className="text-sm font-semibold">Content Calendar</span>
        {activeProject && <span className="text-xs text-muted-foreground">- {activeProject.name}</span>}
        <div className="ml-auto">
          <button onClick={()=>setShowGenerateForm(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-primary text-primary-foreground rounded-md hover:bg-primary/90 transition-colors">
            <Sparkles className="w-3.5 h-3.5"/>Generate month
          </button>
        </div>
      </div>

      {/* Month nav */}
      <div className="flex items-center justify-between px-3 sm:px-6 py-3 border-b border-border bg-muted/20 shrink-0">
        <button onClick={prevMonth} className="p-1.5 rounded-md hover:bg-muted transition-colors"><ChevronLeft className="w-4 h-4"/></button>
        <span className="text-sm font-semibold">{MONTH_NAMES[month]} {year}</span>
        <button onClick={nextMonth} className="p-1.5 rounded-md hover:bg-muted transition-colors"><ChevronRight className="w-4 h-4"/></button>
      </div>

      {/* Legend */}
      {presentPlatforms.length>0 && (
        <div className="flex items-center gap-3 px-4 py-2 border-b border-border bg-background shrink-0 overflow-x-auto scrollbar-none">
          {presentPlatforms.map(p=>(
            <div key={p} className="flex items-center gap-1.5">
              <div className={cn('w-2 h-2 rounded-full',PLATFORM_DOT[p])}/>
              <span className="text-[11px] text-muted-foreground">{p}</span>
            </div>
          ))}
        </div>
      )}

      {/* Day headers */}
      <div className="grid grid-cols-7 border-b border-border shrink-0">
        {['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].map((d,i)=>(
          <div key={d} className="py-2 text-center text-[10px] font-medium text-muted-foreground uppercase tracking-wide">
            <span className="sm:hidden">{['S','M','T','W','T','F','S'][i]}</span>
            <span className="hidden sm:inline">{d}</span>
          </div>
        ))}
      </div>

      {/* Grid */}
      <div className="flex-1 overflow-y-auto">
        <div className="grid grid-cols-7 auto-rows-[minmax(64px,1fr)] sm:auto-rows-[minmax(100px,1fr)]">
          {loading ? Array.from({length:35}).map((_,i)=>(
            <div key={`sk-${i}`} className={cn('border-b border-r border-border p-1.5',i%7===6&&'border-r-0')}>
              <div className="w-5 h-5 rounded-full bg-muted animate-pulse mb-1"/>
              <div className="space-y-1">
                <div className="h-4 rounded bg-muted animate-pulse w-full"/>
                <div className="h-4 rounded bg-muted animate-pulse w-3/4"/>
              </div>
            </div>
          )) : (
            <>
              {Array.from({length:startDay}).map((_,i)=>(
                <div key={`e-${i}`} className="border-b border-r border-border bg-muted/10"/>
              ))}
              {Array.from({length:days}).map((_,i)=>{
                const day=i+1
                const dateStr=`${year}-${String(month+1).padStart(2,'0')}-${String(day).padStart(2,'0')}`
                const de=byDate[dateStr]??[]
                const isToday=day===today.getDate()&&month===today.getMonth()&&year===today.getFullYear()
                const isLast=(i+startDay)%7===6
                const hasSel=selectedEntry&&de.some(e=>e.id===selectedEntry.id)
                const isOv=overflowDay===dateStr

                return (
                  <div key={day} className={cn('group border-b border-r border-border p-1 sm:p-1.5 overflow-visible relative',
                    isLast&&'border-r-0', isToday&&'bg-primary/5 ring-1 ring-inset ring-primary/20',
                    hasSel&&'ring-2 ring-inset ring-primary')}>
                    <div className="flex items-center justify-between mb-1">
                      <div className={cn('text-xs font-medium w-5 h-5 flex items-center justify-center rounded-full',
                        isToday?'bg-primary text-primary-foreground':'text-muted-foreground')}>{day}</div>
                      <button onClick={e=>{e.stopPropagation();setAddDate(dateStr)}}
                        className="opacity-100 sm:opacity-0 sm:group-hover:opacity-100 p-0.5 rounded hover:bg-muted transition-all text-muted-foreground hover:text-foreground" title="Add">
                        <Plus className="w-3 h-3"/>
                      </button>
                    </div>
                    <div className="space-y-0.5">
                      {de.slice(0,3).map(entry=>(
                        <EntryChip key={entry.id} entry={entry} onClick={e=>{e.stopPropagation();setSelectedEntry(entry)}}/>
                      ))}
                      {de.length>3&&(
                        <button onClick={e=>{e.stopPropagation();setOverflowDay(isOv?null:dateStr)}}
                          className="text-[9px] text-primary/70 hover:text-primary pl-1 font-medium transition-colors">
                          +{de.length-3} more
                        </button>
                      )}
                    </div>
                    {isOv&&(
                      <OverflowPopover entries={de}
                        onSelect={e=>{setSelectedEntry(e);setOverflowDay(null)}}
                        onClose={()=>setOverflowDay(null)}/>
                    )}
                  </div>
                )
              })}
            </>
          )}
        </div>
      </div>

      {selectedEntry&&(
        <EntryDetailModal entry={selectedEntry} projectId={params.projectId}
          onClose={()=>setSelectedEntry(null)}
          onStatusChange={s=>handleStatusChange(selectedEntry,s)}
          onSave={u=>handleSave(selectedEntry,u)}
          onDelete={()=>handleDelete(selectedEntry)}/>
      )}
      {addDate!==null&&(
        <AddEntryModal projectId={params.projectId} defaultDate={addDate}
          onClose={()=>setAddDate(null)} onCreated={handleAdded}/>
      )}
      {showGenerateForm&&(
        <GenerateForm projectId={params.projectId} year={year} month={month}
          generating={generating} setGenerating={setGenerating}
          onClose={()=>setShowGenerateForm(false)}
          onDone={()=>{setShowGenerateForm(false);invalidateCalendarCache(cacheKey);loadEntries(false)}}/>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Entry chip
// ---------------------------------------------------------------------------

function EntryChip({entry,onClick}:{entry:CalendarEntry;onClick:(e:React.MouseEvent)=>void}){
  const pill = PLATFORM_PILL[entry.platform]??'bg-muted border-l-2 border-muted-foreground text-muted-foreground'
  const abbr = PLATFORM_ABBR[entry.platform]??entry.platform.slice(0,2).toUpperCase()
  const dot  = STATUS_DOT[entry.status]??'bg-muted-foreground/40'
  const type = entry.type?.toLowerCase()

  const dotColor = PLATFORM_DOT[entry.platform]??'bg-muted-foreground/40'
  return (
    <button onClick={onClick} className="w-full text-left">
      {/* Mobile: dot only */}
      <div className={cn('sm:hidden w-2.5 h-2.5 rounded-full mx-auto my-0.5',dotColor)}/>
      {/* Desktop: full chip */}
      <div className={cn('hidden sm:flex items-center gap-1 rounded-sm px-1 py-0.5 hover:brightness-95 transition-all',pill)}>
        <span className="text-[9px] font-bold shrink-0 opacity-70">{abbr}</span>
        {VIDEO_TYPES.has(type)  && <Video    className="w-2 h-2 shrink-0 opacity-60"/>}
        {type==='image'          && <ImageIcon className="w-2 h-2 shrink-0 opacity-60"/>}
        {type==='carousel'       && <ImageIcon className="w-2 h-2 shrink-0 opacity-60"/>}
        {type==='blog'           && <FileText className="w-2 h-2 shrink-0 opacity-60"/>}
        {type==='blog'&&entry.title ? (
          <span className="text-[10px] truncate leading-tight flex-1">{entry.title}</span>
        ) : entry.media_type==='image'&&entry.media_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={entry.media_url} alt="" className="w-4 h-4 rounded object-cover shrink-0"/>
        ) : (
          <span className="text-[10px] truncate leading-tight flex-1">{entry.content.slice(0,26)||'-'}</span>
        )}
        <div className={cn('w-1.5 h-1.5 rounded-full shrink-0',dot)}/>
      </div>
    </button>
  )
}

// ---------------------------------------------------------------------------
// Overflow popover
// ---------------------------------------------------------------------------

function OverflowPopover({entries,onSelect,onClose}:{entries:CalendarEntry[];onSelect:(e:CalendarEntry)=>void;onClose:()=>void}){
  return (
    <div onClick={e=>e.stopPropagation()}
      className="absolute top-full left-0 sm:top-0 sm:left-full z-30 mt-1 sm:mt-0 sm:ml-1 w-48 sm:w-56 bg-card border border-border rounded-lg shadow-xl p-2 space-y-1">
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">All entries</span>
        <button onClick={onClose} className="text-muted-foreground hover:text-foreground"><X className="w-3 h-3"/></button>
      </div>
      {entries.map(e=><EntryChip key={e.id} entry={e} onClick={()=>onSelect(e)}/>)}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Image upload zone
// ---------------------------------------------------------------------------

function ImageUploadZone({projectId,value,onChange,label='Image'}:{
  projectId:string; value:string; onChange:(url:string)=>void; label?:string
}){
  const fileRef = useRef<HTMLInputElement>(null)
  const [uploading,setUploading] = useState(false)

  async function handleFile(file:File){
    setUploading(true)
    try {
      const {url} = await api.uploadMedia(projectId,file)
      onChange(url); toast.success(`${label} uploaded`)
    } catch(e:unknown){
      const msg = e instanceof Error ? e.message : 'Upload failed'
      toast.error(msg)
    } finally { setUploading(false) }
  }

  if(value) return (
    <div className="relative rounded-lg overflow-hidden border border-border">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={value} alt={label} className="w-full max-h-48 object-cover"/>
      <button onClick={()=>onChange('')}
        className="absolute top-1.5 right-1.5 p-1 bg-black/60 rounded-full text-white hover:bg-black/80 transition-colors">
        <X className="w-3 h-3"/>
      </button>
    </div>
  )

  return (
    <>
      <div onDrop={e=>{e.preventDefault();const f=e.dataTransfer.files[0];if(f)handleFile(f)}}
        onDragOver={e=>e.preventDefault()} onClick={()=>fileRef.current?.click()}
        className="flex flex-col items-center justify-center gap-2 border-2 border-dashed border-border rounded-lg p-4 sm:p-6 cursor-pointer hover:border-primary/50 hover:bg-muted/30 transition-colors">
        {uploading ? <Loader2 className="w-5 h-5 animate-spin text-muted-foreground"/> : (
          <>
            <ImageIcon className="w-5 h-5 text-muted-foreground"/>
            <span className="text-xs text-muted-foreground text-center">
              Drag & drop or click to upload {label}<br/>
              <span className="text-[10px]">PNG, JPG, GIF, WebP · max 50 MB</span>
            </span>
          </>
        )}
      </div>
      <input ref={fileRef} type="file" accept="image/*" className="hidden"
        onChange={e=>{const f=e.target.files?.[0];if(f)handleFile(f)}}/>
    </>
  )
}

// ---------------------------------------------------------------------------
// Video upload zone
// ---------------------------------------------------------------------------

function VideoUploadZone({projectId,value,onChange}:{projectId:string;value:string;onChange:(url:string)=>void}){
  const fileRef = useRef<HTMLInputElement>(null)
  const [uploading,setUploading] = useState(false)

  async function handleFile(file:File){
    setUploading(true)
    try {
      const {url} = await api.uploadMedia(projectId,file)
      onChange(url); toast.success('Video uploaded')
    } catch(e:unknown){
      const msg = e instanceof Error ? e.message : 'Upload failed'
      toast.error(msg.includes('R2') ? 'Video upload requires R2 storage to be configured.' : msg)
    } finally { setUploading(false) }
  }

  if(value) return (
    <div className="relative rounded-lg overflow-hidden border border-border bg-black">
      <video src={value} controls className="w-full max-h-48"/>
      <button onClick={()=>onChange('')}
        className="absolute top-1.5 right-1.5 p-1 bg-black/60 rounded-full text-white hover:bg-black/80 transition-colors">
        <X className="w-3 h-3"/>
      </button>
    </div>
  )

  return (
    <>
      <div onDrop={e=>{e.preventDefault();const f=e.dataTransfer.files[0];if(f)handleFile(f)}}
        onDragOver={e=>e.preventDefault()} onClick={()=>fileRef.current?.click()}
        className="flex flex-col items-center justify-center gap-2 border-2 border-dashed border-border rounded-lg p-4 sm:p-6 cursor-pointer hover:border-primary/50 hover:bg-muted/30 transition-colors">
        {uploading ? <Loader2 className="w-5 h-5 animate-spin text-muted-foreground"/> : (
          <>
            <Video className="w-5 h-5 text-muted-foreground"/>
            <span className="text-xs text-muted-foreground text-center">
              Drag & drop or click to upload video<br/>
              <span className="text-[10px]">MP4, MOV, WebM · max 50 MB · requires R2</span>
            </span>
          </>
        )}
      </div>
      <input ref={fileRef} type="file" accept="video/*" className="hidden"
        onChange={e=>{const f=e.target.files?.[0];if(f)handleFile(f)}}/>
    </>
  )
}

// ---------------------------------------------------------------------------
// Markdown editor (split-pane, uses react-markdown for preview)
// ---------------------------------------------------------------------------

function MarkdownEditor({value,onChange,rows=12}:{value:string;onChange:(v:string)=>void;rows?:number}){
  const [tab,setTab] = useState<'write'|'preview'>('write')
  return (
    <div className="border border-border rounded-lg overflow-hidden">
      <div className="flex border-b border-border bg-muted/30">
        <button onClick={()=>setTab('write')}
          className={cn('flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium transition-colors border-r border-border',
            tab==='write'?'bg-background text-foreground':'text-muted-foreground hover:text-foreground')}>
          <Code2 className="w-3 h-3"/>Write
        </button>
        <button onClick={()=>setTab('preview')}
          className={cn('flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium transition-colors',
            tab==='preview'?'bg-background text-foreground':'text-muted-foreground hover:text-foreground')}>
          <Eye className="w-3 h-3"/>Preview
        </button>
      </div>
      {tab==='write' ? (
        <textarea value={value} onChange={e=>onChange(e.target.value)} rows={rows}
          placeholder={'# Blog Title\n\nWrite your blog content in **markdown**...\n\n## Section\n\nParagraph text here.'}
          className="w-full px-3 py-2.5 text-sm bg-background focus:outline-none resize-none font-mono"/>
      ) : (
        <div className="min-h-[120px] px-4 py-3 prose prose-sm dark:prose-invert max-w-none text-sm">
          {value.trim() ? <ReactMarkdown>{value}</ReactMarkdown> : (
            <p className="text-muted-foreground italic text-xs">Nothing to preview yet.</p>
          )}
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Content-type-aware form fields (shared between Add + Edit)
// ---------------------------------------------------------------------------

interface ContentFormState {
  platforms: string[]
  contentType: string
  date: string
  time: string
  title: string
  content: string
  hashtags: string
  status: string
  mediaUrl: string
  coverUrl: string    // blog cover image
  carouselUrls: string[]  // carousel multi-image
}

function ContentFields({
  state, setState, projectId, isEdit=false,
}:{
  state: ContentFormState
  setState: (patch: Partial<ContentFormState>) => void
  projectId: string
  isEdit?: boolean
}){
  const type = state.contentType.toLowerCase()
  const isVideo   = VIDEO_TYPES.has(type)
  const isImage   = type==='image'
  const isCarousel= type==='carousel'
  const isBlog    = type==='blog'
  const isPost    = !isVideo&&!isImage&&!isCarousel&&!isBlog

  return (
    <div className="space-y-4">
      {/* Platform(s) */}
      <div className="space-y-2">
        <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
          Platforms{!isEdit&&<span className="ml-1.5 normal-case font-normal text-muted-foreground/70">(select multiple)</span>}
        </label>
        <div className="flex flex-wrap gap-1.5">
          {PLATFORMS.map(p=>{
            const active=state.platforms.includes(p)
            return (
              <button key={p} onClick={()=>{
                if(isEdit) setState({platforms:[p]})
                else setState({platforms:active&&state.platforms.length>1?state.platforms.filter(x=>x!==p):Array.from(new Set([...state.platforms,p]))})
              }}
              className={cn('flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium transition-colors border',
                active?'bg-primary text-primary-foreground border-primary':'bg-muted text-muted-foreground border-transparent hover:text-foreground')}>
                <div className={cn('w-1.5 h-1.5 rounded-full',PLATFORM_DOT[p],!active&&'opacity-40')}/>
                {p}
                {active&&!isEdit&&<Check className="w-2.5 h-2.5 ml-0.5"/>}
              </button>
            )
          })}
        </div>
        {!isEdit&&state.platforms.length>1&&(
          <p className="text-[10px] text-muted-foreground">Creates {state.platforms.length} entries - one per platform.</p>
        )}
      </div>

      {/* Content type */}
      <div className="space-y-2">
        <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Content type</label>
        <div className="flex flex-wrap gap-1.5">
          {CONTENT_TYPES.map(t=>(
            <button key={t} onClick={()=>setState({contentType:t})}
              className={cn('px-2.5 py-1 rounded-md text-xs font-medium transition-colors',
                state.contentType===t?'bg-primary text-primary-foreground':'bg-muted text-muted-foreground hover:text-foreground')}>
              {t}
            </button>
          ))}
        </div>
      </div>

      {/* Date + Time */}
      <div className="grid grid-cols-2 gap-2 sm:gap-3">
        <div className="space-y-1.5">
          <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Date</label>
          <input type="date" value={state.date} onChange={e=>setState({date:e.target.value})}
            className="w-full px-3 py-2 text-sm bg-background border border-border rounded-lg focus:outline-none focus:ring-1 focus:ring-primary"/>
        </div>
        <div className="space-y-1.5">
          <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Time <span className="font-normal normal-case">(opt.)</span></label>
          <input type="time" value={state.time} onChange={e=>setState({time:e.target.value})}
            className="w-full px-3 py-2 text-sm bg-background border border-border rounded-lg focus:outline-none focus:ring-1 focus:ring-primary"/>
        </div>
      </div>

      {/* ── Type-specific primary input ── */}

      {/* IMAGE */}
      {isImage&&(
        <div className="space-y-1.5">
          <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Image</label>
          <ImageUploadZone projectId={projectId} value={state.mediaUrl} onChange={u=>setState({mediaUrl:u})}/>
        </div>
      )}

      {/* VIDEO / STORY / REEL */}
      {isVideo&&(
        <div className="space-y-1.5">
          <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">{state.contentType}</label>
          <VideoUploadZone projectId={projectId} value={state.mediaUrl} onChange={u=>setState({mediaUrl:u})}/>
        </div>
      )}

      {/* CAROUSEL */}
      {isCarousel&&(
        <div className="space-y-2">
          <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
            Carousel images <span className="font-normal normal-case">(up to 10)</span>
          </label>
          {state.carouselUrls.map((url,idx)=>(
            <div key={idx} className="space-y-1">
              <div className="flex items-center gap-2">
                <span className="text-[10px] text-muted-foreground w-5">{idx+1}.</span>
                {url ? (
                  <div className="flex-1 flex items-center gap-2">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={url} alt="" className="w-12 h-12 object-cover rounded border border-border"/>
                    <button onClick={()=>{const n=[...state.carouselUrls];n[idx]='';setState({carouselUrls:n})}}
                      className="text-destructive hover:text-destructive/80"><X className="w-3.5 h-3.5"/></button>
                  </div>
                ) : (
                  <CarouselSlotUpload projectId={projectId} onUploaded={u=>{
                    const n=[...state.carouselUrls];n[idx]=u;setState({carouselUrls:n})
                  }}/>
                )}
              </div>
            </div>
          ))}
          {state.carouselUrls.filter(u=>u).length<10&&(
            <button onClick={()=>setState({carouselUrls:[...state.carouselUrls,'']})}
              className="flex items-center gap-1.5 text-xs text-primary hover:underline">
              <Plus className="w-3 h-3"/>Add slide
            </button>
          )}
        </div>
      )}

      {/* BLOG */}
      {isBlog&&(
        <>
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Blog title</label>
            <input value={state.title} onChange={e=>setState({title:e.target.value})}
              placeholder="How to grow your brand in 2025"
              className="w-full px-3 py-2 text-sm bg-background border border-border rounded-lg focus:outline-none focus:ring-1 focus:ring-primary"/>
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Blog content</label>
            <MarkdownEditor value={state.content} onChange={v=>setState({content:v})}/>
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Cover image <span className="font-normal normal-case">(optional)</span></label>
            <ImageUploadZone projectId={projectId} value={state.coverUrl} onChange={u=>setState({coverUrl:u})} label="Cover image"/>
          </div>
        </>
      )}

      {/* POST - text primary, optional image */}
      {isPost&&(
        <>
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Caption / text</label>
            <textarea value={state.content} onChange={e=>setState({content:e.target.value})} rows={4}
              placeholder="Write your post content..."
              className="w-full px-3 py-2 text-sm bg-background border border-border rounded-lg focus:outline-none focus:ring-1 focus:ring-primary resize-none"/>
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Image <span className="font-normal normal-case">(optional)</span></label>
            <ImageUploadZone projectId={projectId} value={state.mediaUrl} onChange={u=>setState({mediaUrl:u})}/>
          </div>
        </>
      )}

      {/* Caption for non-post/non-blog types */}
      {(isImage||isVideo||isCarousel)&&(
        <div className="space-y-1.5">
          <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Caption <span className="font-normal normal-case">(optional)</span></label>
          <textarea value={state.content} onChange={e=>setState({content:e.target.value})} rows={3}
            placeholder="Add a caption..."
            className="w-full px-3 py-2 text-sm bg-background border border-border rounded-lg focus:outline-none focus:ring-1 focus:ring-primary resize-none"/>
        </div>
      )}

      {/* Hashtags (all types) */}
      <div className="space-y-1.5">
        <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Hashtags <span className="font-normal normal-case">(space-separated, optional)</span></label>
        <input value={state.hashtags} onChange={e=>setState({hashtags:e.target.value})} placeholder="marketing launch tips"
          className="w-full px-3 py-2 text-sm bg-background border border-border rounded-lg focus:outline-none focus:ring-1 focus:ring-primary"/>
      </div>

      {/* Status */}
      <div className="space-y-2">
        <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Status</label>
        <div className="flex flex-wrap gap-1.5">
          {STATUSES.map(s=>(
            <button key={s} onClick={()=>setState({status:s})}
              className={cn('px-2.5 py-1 rounded-full text-[10px] font-medium capitalize border transition-colors',
                state.status===s?STATUS_PILL[s]+' border-current/20':'bg-background border-border text-muted-foreground hover:text-foreground')}>
              {s}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}

// Small inline carousel slot uploader
function CarouselSlotUpload({projectId,onUploaded}:{projectId:string;onUploaded:(url:string)=>void}){
  const ref=useRef<HTMLInputElement>(null)
  const [uploading,setUploading]=useState(false)
  async function handle(file:File){
    setUploading(true)
    try{const {url}=await api.uploadMedia(projectId,file);onUploaded(url)}
    catch{toast.error('Upload failed')}
    finally{setUploading(false)}
  }
  return (
    <button onClick={()=>ref.current?.click()} disabled={uploading}
      className="flex items-center gap-1.5 px-3 py-1.5 text-xs border border-dashed border-border rounded-lg text-muted-foreground hover:text-foreground hover:border-primary/50 transition-colors disabled:opacity-50">
      {uploading?<Loader2 className="w-3 h-3 animate-spin"/>:<Upload className="w-3 h-3"/>}
      Upload image
      <input ref={ref} type="file" accept="image/*" className="hidden" onChange={e=>{const f=e.target.files?.[0];if(f)handle(f)}}/>
    </button>
  )
}

// Build API payload from form state
function buildPayload(s: ContentFormState) {
  const type = s.contentType.toLowerCase()
  const isVideo    = VIDEO_TYPES.has(type)
  const isCarousel = type==='carousel'
  const isBlog     = type==='blog'

  let mediaUrl: string|undefined
  let mediaType: string|undefined

  if(isVideo && s.mediaUrl)    { mediaUrl=s.mediaUrl; mediaType='video' }
  else if(isCarousel)           { mediaUrl=s.carouselUrls.filter(Boolean).join(','); mediaType='carousel' }
  else if(isBlog && s.coverUrl) { mediaUrl=s.coverUrl; mediaType='image' }
  else if(s.mediaUrl)           { mediaUrl=s.mediaUrl; mediaType='image' }

  return {
    date: s.date,
    time: s.time||undefined,
    title: s.title||undefined,
    content: isBlog ? s.content : s.content,
    hashtags: parseHashtags(s.hashtags),
    type,
    content_format: TYPE_FORMAT_MAP[s.contentType]??'post',
    status: s.status,
    media_url: mediaUrl||null,
    media_type: mediaType||null,
  }
}

// ---------------------------------------------------------------------------
// Add Entry modal
// ---------------------------------------------------------------------------

function AddEntryModal({projectId,defaultDate,onClose,onCreated}:{
  projectId:string; defaultDate:string
  onClose:()=>void; onCreated:(e:CalendarEntry[])=>void
}){
  const [state,setStateRaw]=useState<ContentFormState>({
    platforms:['Instagram'], contentType:'Post', date:defaultDate, time:'',
    title:'', content:'', hashtags:'', status:'planned', mediaUrl:'', coverUrl:'', carouselUrls:[''],
  })
  function setState(p:Partial<ContentFormState>){setStateRaw(s=>({...s,...p}))}
  const [saving,setSaving]=useState(false)

  async function submit(){
    const isBlog=state.contentType.toLowerCase()==='blog'
    const isVideo=VIDEO_TYPES.has(state.contentType.toLowerCase())
    if(isBlog&&!state.title.trim()){toast.error('Blog title is required');return}
    if(!isBlog&&!isVideo&&!state.content.trim()&&!state.mediaUrl){toast.error('Add content or upload media');return}
    setSaving(true)
    try{
      const payload=buildPayload(state)
      const created=await Promise.all(state.platforms.map(platform=>api.calendar.createEntry(projectId,{...payload,platform})))
      toast.success(state.platforms.length>1?`Added to ${state.platforms.length} platforms`:'Entry added')
      onCreated(created)
    }catch(e:unknown){
      toast.error(e instanceof Error?e.message:'Failed to add entry')
    }finally{setSaving(false)}
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50 sm:p-4" onClick={onClose}>
      <div className="bg-card border border-border rounded-t-2xl sm:rounded-2xl shadow-2xl w-full sm:max-w-lg max-h-[92vh] flex flex-col" onClick={e=>e.stopPropagation()}>
        {/* Mobile drag handle */}
        <div className="sm:hidden flex justify-center pt-3 pb-1 shrink-0">
          <div className="w-8 h-1 rounded-full bg-muted-foreground/30"/>
        </div>
        <div className="flex items-center justify-between px-5 py-3 sm:py-4 border-b border-border shrink-0">
          <div className="flex items-center gap-2">
            <Plus className="w-4 h-4 text-primary"/>
            <span className="font-semibold text-sm">Add to Calendar</span>
          </div>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground"><X className="w-4 h-4"/></button>
        </div>
        <div className="flex-1 overflow-y-auto p-4 sm:p-5">
          <ContentFields state={state} setState={setState} projectId={projectId}/>
        </div>
        <div className="px-4 sm:px-5 py-3 sm:py-4 border-t border-border shrink-0">
          <button onClick={submit} disabled={saving}
            className="w-full flex items-center justify-center gap-2 py-2.5 text-sm font-medium bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 disabled:opacity-50 transition-colors">
            {saving?<Loader2 className="w-4 h-4 animate-spin"/>:<Plus className="w-4 h-4"/>}
            {saving?'Adding…':state.platforms.length>1?`Add to ${state.platforms.length} platforms`:'Add to calendar'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Entry detail modal (view + full edit)
// ---------------------------------------------------------------------------

function EntryDetailModal({entry,projectId,onClose,onStatusChange,onSave,onDelete}:{
  entry:CalendarEntry; projectId:string
  onClose:()=>void; onStatusChange:(s:string)=>void
  onSave:(u:Partial<CalendarEntry>)=>Promise<void>; onDelete:()=>void
}){
  const [editing,setEditing]=useState(false)
  const [saving,setSaving]=useState(false)

  const type=entry.type?.toLowerCase()
  const isCarousel=type==='carousel'
  const isBlog    =type==='blog'

  const carouselImages = isCarousel&&entry.media_url ? entry.media_url.split(',').filter(Boolean) : []

  // Edit state
  const [state,setStateRaw]=useState<ContentFormState>({
    platforms:[entry.platform], contentType:entry.type??'Post',
    date:entry.date, time:entry.time??'', title:entry.title??'',
    content:entry.content, hashtags:entry.hashtags.join(' '),
    status:entry.status, mediaUrl:isCarousel?'':(entry.media_url??''),
    coverUrl:isBlog?(entry.media_url??''):'',
    carouselUrls:isCarousel&&entry.media_url?entry.media_url.split(',').filter(Boolean):[''],
  })
  function setState(p:Partial<ContentFormState>){setStateRaw(s=>({...s,...p}))}

  useEffect(()=>{
    if(!editing) setStateRaw({
      platforms:[entry.platform], contentType:entry.type??'Post',
      date:entry.date, time:entry.time??'', title:entry.title??'',
      content:entry.content, hashtags:entry.hashtags.join(' '),
      status:entry.status, mediaUrl:isCarousel?'':(entry.media_url??''),
      coverUrl:isBlog?(entry.media_url??''):'',
      carouselUrls:isCarousel&&entry.media_url?entry.media_url.split(',').filter(Boolean):[''],
    })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  },[entry,editing])

  async function save(){
    setSaving(true)
    try{
      const payload=buildPayload(state)
      await onSave({...payload, platform:state.platforms[0]})
      setEditing(false)
    }finally{setSaving(false)}
  }

  const badge=PLATFORM_BADGE[entry.platform]??'bg-muted text-muted-foreground'

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50 sm:p-4" onClick={onClose}>
      <div className="bg-card border border-border rounded-t-2xl sm:rounded-2xl shadow-2xl w-full sm:max-w-lg max-h-[92vh] flex flex-col" onClick={e=>e.stopPropagation()}>
        {/* Mobile drag handle */}
        <div className="sm:hidden flex justify-center pt-3 pb-1 shrink-0">
          <div className="w-8 h-1 rounded-full bg-muted-foreground/30"/>
        </div>
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 sm:py-4 border-b border-border shrink-0">
          <div className="flex items-center gap-2 flex-wrap">
            <div className={cn('w-2.5 h-2.5 rounded-full',PLATFORM_DOT[entry.platform]??'bg-muted-foreground')}/>
            <span className={cn('text-xs font-semibold px-2 py-0.5 rounded-full',badge)}>{entry.platform}</span>
            <span className="text-xs text-muted-foreground">{formatDate(entry.date)}</span>
            {entry.time&&<span className="flex items-center gap-1 text-xs text-muted-foreground"><Clock className="w-3 h-3"/>{entry.time}</span>}
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {!editing&&(
              <button onClick={()=>setEditing(true)}
                className="flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium border border-border rounded-md hover:bg-muted transition-colors">
                <Pencil className="w-3 h-3"/>Edit
              </button>
            )}
            <button onClick={onClose} className="text-muted-foreground hover:text-foreground"><X className="w-4 h-4"/></button>
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-5">
          {editing ? (
            <ContentFields state={state} setState={setState} projectId={projectId} isEdit/>
          ) : (
            <div className="space-y-5">
              {/* Type tags */}
              <div className="flex items-center gap-2 flex-wrap">
                {entry.type&&<span className="text-xs px-2 py-1 rounded-md bg-muted text-muted-foreground capitalize">{entry.type}</span>}
                {entry.content_format&&entry.content_format!==entry.type&&(
                  <span className="text-xs px-2 py-1 rounded-md bg-muted text-muted-foreground capitalize">{entry.content_format}</span>
                )}
              </div>

              {/* Blog */}
              {isBlog&&(
                <>
                  {entry.title&&<h2 className="text-lg font-bold leading-tight">{entry.title}</h2>}
                  {entry.media_url&&(
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={entry.media_url} alt="Cover" className="w-full max-h-48 object-cover rounded-lg border border-border"/>
                  )}
                  <div className="prose prose-sm dark:prose-invert max-w-none text-sm">
                    <ReactMarkdown>{entry.content}</ReactMarkdown>
                  </div>
                </>
              )}

              {/* Image */}
              {!isBlog&&entry.media_type==='image'&&entry.media_url&&(
                // eslint-disable-next-line @next/next/no-img-element
                <img src={entry.media_url} alt="Media" className="w-full max-h-56 object-cover rounded-lg border border-border"/>
              )}

              {/* Video */}
              {entry.media_type==='video'&&entry.media_url&&(
                <div className="rounded-lg overflow-hidden border border-border bg-black">
                  <video src={entry.media_url} controls className="w-full max-h-56"/>
                </div>
              )}

              {/* Carousel */}
              {isCarousel&&carouselImages.length>0&&(
                <div className="grid grid-cols-3 gap-1.5">
                  {carouselImages.map((url,i)=>(
                    // eslint-disable-next-line @next/next/no-img-element
                    <img key={i} src={url} alt={`Slide ${i+1}`} className="w-full aspect-square object-cover rounded-md border border-border"/>
                  ))}
                </div>
              )}

              {/* Caption / content text */}
              {entry.content.trim()&&(
                <div>
                  <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide block mb-1">
                    {isBlog?'':'Caption'}
                  </span>
                  {!isBlog&&<p className="text-sm leading-relaxed whitespace-pre-wrap">{entry.content}</p>}
                </div>
              )}

              {/* Hashtags */}
              {entry.hashtags.length>0&&(
                <div>
                  <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide block mb-1">Hashtags</span>
                  <p className="text-sm text-primary/70">{entry.hashtags.map(h=>`#${h.replace(/^#/,'')}`).join(' ')}</p>
                </div>
              )}

              {/* Status */}
              <div>
                <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide block mb-2">Status</span>
                <div className="flex flex-wrap gap-1.5">
                  {STATUSES.map(s=>(
                    <button key={s} onClick={()=>onStatusChange(s)}
                      className={cn('flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-medium capitalize border transition-colors',
                        entry.status===s?STATUS_PILL[s]+' border-current/20':'bg-background border-border text-muted-foreground hover:text-foreground')}>
                      {entry.status===s&&<Check className="w-2.5 h-2.5"/>}{s}
                    </button>
                  ))}
                </div>
              </div>

              {/* External link fallback for unknown media */}
              {entry.media_url&&entry.media_type!=='image'&&entry.media_type!=='video'&&!isCarousel&&!isBlog&&(
                <a href={entry.media_url} target="_blank" rel="noopener noreferrer"
                  className="flex items-center gap-2 px-3 py-2.5 rounded-lg border border-border hover:bg-muted transition-colors text-sm">
                  <ExternalLink className="w-4 h-4 text-muted-foreground"/>
                  <span className="flex-1 truncate text-xs">{entry.media_url}</span>
                </a>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-4 sm:px-5 py-3 sm:py-4 border-t border-border flex items-center gap-2 shrink-0">
          {editing?(
            <>
              <button onClick={save} disabled={saving}
                className="flex-1 flex items-center justify-center gap-1.5 py-2 text-xs font-medium bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 disabled:opacity-50 transition-colors">
                {saving?<Loader2 className="w-3.5 h-3.5 animate-spin"/>:<Check className="w-3.5 h-3.5"/>}
                Save changes
              </button>
              <button onClick={()=>setEditing(false)}
                className="px-4 py-2 text-xs font-medium border border-border rounded-lg hover:bg-muted transition-colors">Cancel</button>
            </>
          ):(
            <button onClick={onDelete}
              className="flex items-center gap-1.5 px-4 py-2 text-xs font-medium text-destructive border border-destructive/20 rounded-lg hover:bg-destructive/5 transition-colors">
              <Trash2 className="w-3.5 h-3.5"/>Remove from calendar
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Generate form modal
// ---------------------------------------------------------------------------

function GenerateForm({projectId,year,month,generating,setGenerating,onClose,onDone}:{
  projectId:string;year:number;month:number
  generating:boolean;setGenerating:(v:boolean)=>void
  onClose:()=>void;onDone:()=>void
}){
  const [platforms,setPlatforms]=useState(['Instagram','Facebook'])
  const [ppw,setPpw]=useState(3)
  const [themes,setThemes]=useState('')
  function toggle(p:string){setPlatforms(prev=>prev.includes(p)?prev.filter(x=>x!==p):[...prev,p])}
  async function generate(){
    if(!platforms.length){toast.error('Select at least one platform');return}
    setGenerating(true)
    try{
      await api.calendar.generate(projectId,{platforms,period:`${MONTH_NAMES[month]} ${year}`,posts_per_week:ppw,goals:themes.trim()||undefined})
      toast.success('Calendar generated!'); onDone()
    }catch{toast.error('Generation failed')}
    finally{setGenerating(false)}
  }
  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50 sm:p-4">
      <div className="bg-card border border-border rounded-t-2xl sm:rounded-2xl shadow-2xl w-full sm:max-w-md">
        <div className="sm:hidden flex justify-center pt-3 pb-1">
          <div className="w-8 h-1 rounded-full bg-muted-foreground/30"/>
        </div>
        <div className="flex items-center justify-between px-5 py-3 sm:py-4 border-b border-border">
          <div className="flex items-center gap-2"><Sparkles className="w-4 h-4 text-primary"/><span className="font-semibold text-sm">Generate {MONTH_NAMES[month]} Calendar</span></div>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground"><X className="w-4 h-4"/></button>
        </div>
        <div className="p-4 sm:p-5 space-y-4">
          <div className="space-y-2">
            <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Platforms</label>
            <div className="flex flex-wrap gap-1.5">
              {PLATFORMS.map(p=>(
                <button key={p} onClick={()=>toggle(p)}
                  className={cn('flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium transition-colors',
                    platforms.includes(p)?'bg-primary text-primary-foreground':'bg-muted text-muted-foreground hover:text-foreground')}>
                  {platforms.includes(p)&&<div className={cn('w-1.5 h-1.5 rounded-full',PLATFORM_DOT[p])}/>}{p}
                </button>
              ))}
            </div>
          </div>
          <div className="space-y-2">
            <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Posts per week</label>
            <div className="flex gap-1.5">
              {[1,2,3,5,7].map(n=>(
                <button key={n} onClick={()=>setPpw(n)}
                  className={`w-9 h-9 rounded-md text-sm font-medium transition-colors ${ppw===n?'bg-primary text-primary-foreground':'bg-muted text-muted-foreground hover:text-foreground'}`}>{n}</button>
              ))}
            </div>
          </div>
          <div className="space-y-2">
            <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Goals / Themes <span className="normal-case font-normal">(optional)</span></label>
            <input value={themes} onChange={e=>setThemes(e.target.value)} placeholder="e.g. summer sale, product launch"
              className="w-full px-3 py-2 text-sm bg-background border border-border rounded-lg focus:outline-none focus:ring-1 focus:ring-primary"/>
          </div>
          <button onClick={generate} disabled={generating}
            className="w-full flex items-center justify-center gap-2 py-2.5 text-sm font-medium bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 disabled:opacity-50 transition-colors">
            {generating?<Loader2 className="w-4 h-4 animate-spin"/>:<Sparkles className="w-4 h-4"/>}
            {generating?'Generating…':'Generate'}
          </button>
        </div>
      </div>
    </div>
  )
}
