import { NextResponse } from "next/server";
import { normalizeOutdoorQuery, parseOutdoorResults } from "@/lib/outdoor-search";

export const runtime="nodejs";
export const dynamic="force-dynamic";

// Nominatim's OSMF public endpoint permits low-volume, user-initiated searches,
// not autocomplete. Limit to one outbound request per 1.1 seconds per server
// instance, and cache repeated searches. For multi-instance production
// deployments use a centrally rate-limited geocoding provider instead.
const NOMINATIM_URL="https://nominatim.openstreetmap.org/search";
const APP_USER_AGENT="IndoorMapStudio/0.1 (https://github.com/zedmar09/map-libre)";
const MIN_INTERVAL_MS=1100;
const CACHE_DURATION_MS=6*60*60*1000;
const resultCache=new Map<string,{expires:number;results:ReturnType<typeof parseOutdoorResults>}>();
let nextRequestAt=0;

export async function GET(request:Request){
  const query=normalizeOutdoorQuery(new URL(request.url).searchParams.get("q"));
  if(!query)return NextResponse.json({error:"Enter a place or address (2–140 characters)."},
    {status:400});
  const key=query.toLocaleLowerCase("en");
  const now=Date.now();
  const cached=resultCache.get(key);
  if(cached&&cached.expires>now)return NextResponse.json({results:cached.results});
  if(now<nextRequestAt)return NextResponse.json(
    {error:"Search is temporarily busy. Try again shortly."},
    {status:429,headers:{"Retry-After":"2"}});
  nextRequestAt=now+MIN_INTERVAL_MS;
  const url=new URL(NOMINATIM_URL);
  url.searchParams.set("q",query);
  url.searchParams.set("format","jsonv2");
  url.searchParams.set("limit","5");
  url.searchParams.set("addressdetails","0");
  try{
    const response=await fetch(url,{
      headers:{"User-Agent":APP_USER_AGENT,"Accept":"application/json","Accept-Language":"en"},
      cache:"no-store",
      signal:AbortSignal.timeout(9000),
    });
    if(!response.ok){
      return NextResponse.json({
        error:response.status===429?"The location provider is busy. Try again shortly.":
          "Location search is temporarily unavailable.",
      },{status:response.status===429?429:502});
    }
    const data:unknown=await response.json();
    if(!Array.isArray(data))throw new Error("Unexpected location response");
    const results=parseOutdoorResults(data);
    if(resultCache.size>=80){
      for(const [cacheKey,entry] of resultCache)if(entry.expires<=now)resultCache.delete(cacheKey);
      if(resultCache.size>=80)resultCache.delete(resultCache.keys().next().value!);
    }
    resultCache.set(key,{expires:now+CACHE_DURATION_MS,results});
    return NextResponse.json({results});
  }catch{
    return NextResponse.json({error:"Could not reach the location search service. Try again."},
      {status:502});
  }
}
