package controllers

import (
	"encoding/json"
	"fmt"
	"os"
	"testing"
	"time"

	v1 "github.com/davidlangworthy/jobtree/api/v1"
	"github.com/davidlangworthy/jobtree/pkg/binder"
	"github.com/davidlangworthy/jobtree/pkg/keys"
	"github.com/davidlangworthy/jobtree/pkg/pack"
)

// Polygraph trace harness: drives the REAL emitSparePods over a finite action
// domain and emits {pre, action, data, post} windows as NDJSON.
// Observable state mirrors NodeFailure.tla: per spare index, pod liveness and
// the closure reason of its lease.

const declared = 3

type proj struct {
	Pod    map[string]string `json:"pod"`    // idx -> Live | Gone
	Reason map[string]string `json:"reason"` // idx -> None | Swap
}

func (p proj) key() string { b, _ := json.Marshal(p); return string(b) }

func initProj() proj {
	p := proj{Pod: map[string]string{}, Reason: map[string]string{}}
	for i := 0; i < declared; i++ {
		p.Pod[fmt.Sprint(i)] = "Gone"
		p.Reason[fmt.Sprint(i)] = "None"
	}
	return p
}

func newPlan() pack.Plan {
	gs := make([]pack.GroupPlacement, declared)
	for i := 0; i < declared; i++ {
		gs[i] = pack.GroupPlacement{GroupIndex: i,
			SparePlacements: []pack.NodeAllocation{{Node: fmt.Sprintf("node-%d", i), GPUs: 1}}}
	}
	return pack.Plan{TotalSpares: declared, Groups: gs}
}

// materialize rebuilds a ClusterState exactly matching a projection.
func materialize(p proj) (*RunController, *v1.Run, *ClusterState) {
	run := &v1.Run{ObjectMeta: v1.ObjectMeta{Name: "job", Namespace: keys.DefaultNamespace}}
	st := &ClusterState{Runs: map[string]*v1.Run{keys.NamespacedKey(run.Namespace, run.Name): run}}
	for i := 0; i < declared; i++ {
		k := fmt.Sprint(i)
		if p.Pod[k] == "Live" {
			st.Pods = append(st.Pods, binder.PodManifest{
				Namespace: run.Namespace, Name: sparePodName(run, i), GPUs: 1,
				Labels: map[string]string{
					binder.LabelRunName: run.Name, binder.LabelRunRole: binder.RoleSpare,
					binder.LabelGroupIndex: fmt.Sprint(i)},
			})
		}
		if p.Reason[k] == "Swap" {
			l := v1.Lease{
				Spec: v1.LeaseSpec{
					RunRef: v1.RunReference{Name: run.Name, Namespace: run.Namespace},
					Slice:  v1.LeaseSlice{Nodes: []string{fmt.Sprintf("node-%d#0", i)}, Role: binder.RoleSpare},
				},
				Status: v1.LeaseStatus{Closed: true, ClosureReason: "Swap"},
			}
			l.Annotations = map[string]string{binder.AnnotationPodName: sparePodName(run, i)}
			st.Leases = append(st.Leases, l)
		}
	}
	return NewRunController(st, runClock{now: time.Date(2024, 1, 1, 10, 0, 0, 0, time.UTC)}), run, st
}

func project(run *v1.Run, st *ClusterState) proj {
	p := proj{Pod: map[string]string{}, Reason: map[string]string{}}
	live := map[string]bool{}
	for i := range st.Pods {
		q := &st.Pods[i]
		if q.Labels[binder.LabelRunRole] == binder.RoleSpare && q.Labels[binder.LabelRunName] == run.Name {
			live[q.Name] = true
		}
	}
	consumed := map[string]bool{}
	for i := range st.Leases {
		l := &st.Leases[i]
		if l.Status.Closed && l.Spec.Slice.Role == binder.RoleSpare && l.Status.ClosureReason == "Swap" {
			consumed[binder.LeasePodName(l)] = true
		}
	}
	for i := 0; i < declared; i++ {
		n := sparePodName(run, i)
		p.Pod[fmt.Sprint(i)] = map[bool]string{true: "Live", false: "Gone"}[live[n]]
		p.Reason[fmt.Sprint(i)] = map[bool]string{true: "Swap", false: "None"}[consumed[n]]
	}
	return p
}

type step struct{ Action string; Data map[string]any }

func domain() []step {
	out := []step{{Action: "TopUp", Data: map[string]any{}}}
	for i := 0; i < declared; i++ {
		out = append(out, step{"LosePod", map[string]any{"idx": i}})
		out = append(out, step{"SwapConsume", map[string]any{"idx": i}})
	}
	return out
}

func apply(p proj, s step) proj {
	c, run, st := materialize(p)
	switch s.Action {
	case "TopUp":
		c.emitSparePods(run, newPlan(), 1, "Start", nil)
	case "LosePod":
		i := s.Data["idx"].(int)
		dropPodByName(st, sparePodName(run, i))
	case "SwapConsume":
		i := s.Data["idx"].(int)
		k := fmt.Sprint(i)
		if p.Reason[k] == "None" && p.Pod[k] == "Live" {
			np := p
			np.Reason = map[string]string{}
			np.Pod = map[string]string{}
			for kk, vv := range p.Reason { np.Reason[kk] = vv }
			for kk, vv := range p.Pod { np.Pod[kk] = vv }
			np.Reason[k] = "Swap"
			np.Pod[k] = "Gone"
			return np
		}
		return p
	}
	return project(run, st)
}

type window struct {
	Pre    proj           `json:"pre"`
	Action string         `json:"action"`
	Data   map[string]any `json:"data"`
	Post   proj           `json:"post"`
}

func writeScenario(t *testing.T, dir, name string, steps []step) int {
	f, err := os.Create(dir + "/" + name + ".ndjson")
	if err != nil { t.Fatal(err) }
	defer f.Close()
	cur := initProj()
	n := 0
	for _, s := range steps {
		post := apply(cur, s)
		b, _ := json.Marshal(window{Pre: cur, Action: s.Action, Data: s.Data, Post: post})
		fmt.Fprintln(f, string(b))
		cur = post
		n++
	}
	return n
}

func TestPolygraphEmitTraces(t *testing.T) {
	outDir := os.Getenv("POLYGRAPH_TRACE_DIR")
	if outDir == "" { t.Skip("set POLYGRAPH_TRACE_DIR to emit") }
	T := func() step { return step{"TopUp", map[string]any{}} }
	L := func(i int) step { return step{"LosePod", map[string]any{"idx": i}} }
	S := func(i int) step { return step{"SwapConsume", map[string]any{"idx": i}} }

	scen := []struct{ name string; steps []step }{
		{"s01_hold_then_idempotent", []step{T(), T(), T()}},
		{"s02_swap_low_index_then_topup", []step{T(), S(0), T(), T()}},
		{"s03_swap_high_index_then_topup", []step{T(), S(2), T(), T()}},
		{"s04_swap_middle_then_topup", []step{T(), S(1), T(), T()}},
		{"s05_evict_then_refill", []step{T(), L(1), T(), T()}},
		{"s06_evict_low_then_refill", []step{T(), L(0), T(), T()}},
		{"s07_swap_low_then_evict_high", []step{T(), S(0), L(2), T(), T()}},
		{"s08_swap_high_then_evict_low", []step{T(), S(2), L(0), T(), T()}},
		{"s09_two_swaps", []step{T(), S(0), T(), S(1), T(), T()}},
		{"s10_evict_all_then_refill", []step{T(), L(0), L(1), L(2), T(), T()}},
		{"s11_swap_all", []step{T(), S(0), T(), S(1), T(), S(2), T()}},
		{"s12_topup_before_hold", []step{L(0), T(), S(1), T()}},
		{"s13_swap_then_evict_same", []step{T(), S(1), L(1), T(), T()}},
		{"s14_interleaved", []step{T(), L(2), T(), S(0), T(), L(1), T(), T()}},
	}
	total := 0
	for _, sc := range scen { total += writeScenario(t, outDir, sc.name, sc.steps) }
	t.Logf("scenarios=%d windows=%d", len(scen), total)
}
