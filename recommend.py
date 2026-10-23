"""Rule-based next-step engine. No AI call. Topic key = "moduleIndex:topicIndex"."""

def next_step(rm, completed):
    done, mods = set(completed), rm["modules"]
    total = sum(len(m["topics"]) for m in mods)
    per_topic = round(rm.get("total_hours", 0) * 60 / total) if total else 0
    finished = lambda i: all(f"{i}:{t}" in done for t in range(len(mods[i]["topics"])))
    left = sum(1 for i, m in enumerate(mods) for t in range(len(m["topics"])) if f"{i}:{t}" not in done)
    if not left:
        return {"done": True, "message": "Roadmap complete. Finish your capstone and pick a new skill."}
    todo = [i for i in range(len(mods)) if not finished(i)]
    ready = [i for i in todo if all(finished(r) for r in mods[i].get("requires", []))]
    i = (ready or todo)[0]                      # first module whose prerequisites are met
    t = next(t for t in range(len(mods[i]["topics"])) if f"{i}:{t}" not in done)
    reqs = mods[i].get("requires", [])
    if reqs: why = f"It builds on '{mods[reqs[-1]]['title']}', which you have completed."
    elif not done: why = "It is the first step of your roadmap."
    else: why = f"It is the next unfinished topic in order, in '{mods[i]['title']}'."
    return {"done": False, "module_index": i, "topic_index": t, "topic": mods[i]["topics"][t], "module": mods[i]["title"], "why": why,
            "estimated_minutes": per_topic, "remaining_minutes": per_topic * left,
            "practice": (mods[i]["practice"] or [None])[0]}
