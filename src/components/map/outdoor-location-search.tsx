"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { LoaderCircle, MapPin, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  normalizeOutdoorQuery, type OutdoorLocation,
} from "@/lib/outdoor-search";

type Props={
  selected:OutdoorLocation|null;
  onSelect:(location:OutdoorLocation)=>void;
};

export function OutdoorLocationSearch({selected,onSelect}:Props){
  const [query,setQuery]=useState("");
  const [results,setResults]=useState<OutdoorLocation[]>([]);
  const [loading,setLoading]=useState(false);
  const [searched,setSearched]=useState(false);
  const [error,setError]=useState<string|null>(null);
  const controller=useRef<AbortController|null>(null);

  useEffect(()=>()=>controller.current?.abort(),[]);

  const search=async(event:FormEvent<HTMLFormElement>)=>{
    event.preventDefault();
    const value=normalizeOutdoorQuery(query);
    if(!value){
      setError("Enter a place or address (2–140 characters).");
      setResults([]);
      setSearched(false);
      return;
    }
    controller.current?.abort();
    const abort=new AbortController();
    controller.current=abort;
    setLoading(true);
    setError(null);
    setSearched(false);
    setResults([]);
    try{
      const response=await fetch(`/api/location-search?q=${encodeURIComponent(value)}`,{
        signal:abort.signal,
      });
      const payload:unknown=await response.json();
      if(abort.signal.aborted)return;
      if(!payload||typeof payload!=="object")throw new Error("Invalid search response");
      const record=payload as {results?:OutdoorLocation[];error?:string};
      if(!response.ok)throw new Error(record.error??"Location search failed.");
      if(!Array.isArray(record.results))throw new Error("Invalid location results.");
      setResults(record.results);
      setSearched(true);
    }catch(reason){
      if(abort.signal.aborted)return;
      setError(reason instanceof Error?reason.message:"Unable to search. Try again.");
    }finally{
      if(controller.current===abort){
        controller.current=null;
        setLoading(false);
      }
    }
  };

  return <section className="rounded-xl border border-border bg-white p-3"
    aria-label="Search outdoor locations">
    <h3 className="text-sm font-semibold">Find a location</h3>
    <p className="mt-1 text-xs leading-5 text-muted-foreground">
      Search for a place, landmark or address. Select a result to fly the map there.
    </p>
    <form className="mt-3 flex gap-2" onSubmit={event=>{void search(event)}}>
      <label htmlFor="outdoor-location-query" className="sr-only">Place or address</label>
      <input id="outdoor-location-query" type="search" value={query}
        minLength={2} maxLength={140} autoComplete="off"
        onChange={event=>setQuery(event.target.value)}
        placeholder="e.g. Rizal Park, Manila"
        className="h-10 min-w-0 flex-1 rounded-md border border-input bg-white px-3 text-sm"
        aria-describedby="outdoor-search-note" />
      <Button size="sm" type="submit" disabled={loading}
        aria-label={loading?"Searching locations":"Search locations"}>
        {loading?<LoaderCircle className="animate-spin"/>:<Search/>}
        <span className="sr-only">Search</span>
      </Button>
    </form>
    <div role="status" aria-live="polite" className="mt-2 text-xs">
      {error&&<p className="text-red-700">{error}</p>}
      {loading&&<p className="text-muted-foreground">Finding locations…</p>}
      {searched&&!results.length&&<p className="text-muted-foreground">
        No matching locations found. Try a more specific name or address.
      </p>}
    </div>
    {results.length>0&&<div className="mt-2">
      <p className="text-xs font-semibold text-slate-700">Choose a result</p>
      <ul className="mt-2 max-h-72 space-y-1 overflow-y-auto">
        {results.map((location,index)=><li key={`${location.id}-${index}`}>
          <button type="button" aria-pressed={selected?.id===location.id}
            className={`flex w-full items-start gap-2 rounded-md border px-2 py-2 text-left text-xs leading-5 transition-colors ${selected?.id===location.id?
              "border-blue-500 bg-blue-50":"border-slate-200 hover:bg-slate-50"}`}
            onClick={()=>onSelect(location)}>
            <MapPin className="mt-0.5 size-4 shrink-0 text-blue-700"/>
            <span className="min-w-0 break-words">{location.label}</span>
          </button>
        </li>)}
      </ul>
    </div>}
    <p id="outdoor-search-note" className="mt-3 text-[11px] text-muted-foreground">
      Search results © <a className="underline" href="https://www.openstreetmap.org/copyright"
        target="_blank" rel="noopener noreferrer">OpenStreetMap contributors</a>.
      Searches run when you press Search, not while typing.
    </p>
  </section>;
}
