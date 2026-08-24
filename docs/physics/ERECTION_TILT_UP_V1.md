# Quasi-static tilt-up erection models v1

This document describes the temporary erection mechanics introduced by #104, the adaptive path envelope introduced by #106, the static-only frame solve from #108, and the project/application transport introduced by #110/#112. These models are deliberately separate from the operational mast load case and from any future normative erection/load factors.

## Model identities

Single prescribed angle:

```text
tilt-up-quasi-static-hinge-v1
```

Adaptive path envelope:

```text
tilt-up-quasi-static-envelope-v1
```

The envelope composes the single-angle model. It does not implement a second structural model.

## Geometry

The same generated 3D frame topology used by the operational calculation is rigidly rotated about one actual base edge selected as the erection hinge. Member connectivity, section properties and the 6-DOF Euler–Bernoulli frame formulation are unchanged.

The erection angle is a rigid configuration parameter. The elastic frame solve then computes small displacements about that prescribed configuration.

Persisted `project/v1` data never stores generated FEM node IDs. The user selects a semantic base-edge index and top-corner index; one structural resolver maps those topology-relative selectors to the current generated `baseNodeIds` / `topNodeIds` before the envelope is solved.

## Temporary support state

The operational model restrains all three base nodes. That state is not reused during tilt-up.

For erection:

- the two hinge nodes are restrained in translation and free in rotation;
- the third base node is free;
- one translational gauge DOF on a control node removes the remaining rigid-body rotation about the hinge and therefore prescribes the requested angle.

The gauge direction is selected from the Cartesian component with the largest rigid-rotation tangent about the hinge, which avoids an arbitrarily weak kinematic constraint.

The gauge is not a physical support. Its reaction is required to vanish after the cable tension has been solved. A non-negligible gauge reaction is therefore an equilibrium failure, not a design reaction.

## Physical erection loads

The first model includes only:

- physical steel member weight `rho * A * g` in global `-Z`;
- physical top-equipment weight in global `-Z`.

It intentionally does **not** reuse operational `deadLoadFactor`, `equipmentLoadFactor`, `windLoadFactor`, material safety factors or the historical crane-boom coefficient as erection multipliers.

Ice, wind during erection, cable self-weight, pulley losses, cable elasticity, ground contact and dynamic winch effects are outside v1 until each receives an explicit physical/normative contract.

## Cable equilibrium

A real cable line is defined by:

- one mast attachment node, which rotates with the mast;
- one anchor point fixed in world coordinates.

For hinge axis unit vector `e_h`, hinge point `r_h`, load point `r` and force `F`, the signed projected moment is

```text
M_h = e_h dot ((r - r_h) x F)
```

Let `M_g` be the total physical-gravity moment and `a_c` the projected hinge moment produced by one newton of cable tension. Required quasi-static tension is

```text
T = -M_g / a_c
```

The resulting load case is solved by the real 6-DOF frame FEM. Erection uses the canonical `analyzeFrameStatic()` path: displacements, rotations, reactions, member end forces and equilibrium diagnostics are recovered exactly as in the operational solver, but the unrelated operational global-buckling eigenproblem is not solved at every erection angle.

The artificial gauge reaction must be approximately zero, while the normal free-DOF and global moment-equilibrium residuals remain within solver tolerance.

The model fails explicitly when:

- the cable has effectively zero hinge moment arm;
- the requested equilibrium would require cable compression;
- the gauge geometry is singular.

No arbitrary spring or numerical regularization is substituted for these physical infeasibilities.

## Member demand convention

For every frame member, the envelope consumes the existing 12-component local end-force vector. At each end:

```text
N = |Fx|
V = hypot(Fy, Fz)
T = |Mx|
M = hypot(My, Mz)
```

The member envelope stores the maximum of each magnitude over both ends and over all sampled erection angles. These are physical action demands only. They are not collapsed into one erection utilization until an erection-specific acceptance contract exists.

## Adaptive path envelope

The anchor remains fixed in world coordinates for the entire path. Because the mast attachment rotates, cable direction and cable moment arm change naturally with erection angle.

A bounded initial angular grid is refined deterministically. For every feasible angle the refinement vector contains:

- required cable tension;
- maximum frame displacement;
- hinge force/moment resultants;
- every member's `N`, `V`, `T`, `M` demand.

An interval is refined when midpoint behavior is insufficiently represented by endpoint interpolation or when the physical feasibility/status key changes. Refinement stops on explicit relative-response tolerance, minimum angular step, maximum depth or maximum evaluation count.

The result reports the actual sampled angles, governing sample index/angle for each envelope quantity and convergence diagnostics. Budget/depth exhaustion is returned as non-convergence rather than silently accepting an under-resolved envelope.

The generic adaptive sampler also exposes an optional pre-evaluation hook. It is invoked only before a new non-cached point. The numerics package gives that hook no application semantics; the application layer uses it to check cooperative cancellation and publish erection progress before each expensive angle solve.

## Portable project and application stage

Erection is an optional sibling of the operational project and guys configuration:

```text
project/v1
  project  -> operational user input
  guys?    -> optional guy-stage input
  erection?-> optional erection-stage input
```

The durable erection input contains only user-owned data:

- `hingeBaseEdgeIndex`;
- `attachmentTopCornerIndex`;
- fixed world `anchorPointM`;
- `rotationSense`;
- start/end angles;
- reproducible adaptive-sampling controls.

It never persists generated node/member IDs, cable-tension history, samples, reactions, displacements or member forces.

`calculateProjectErection()` is the headless application boundary for this stage. The stage-oriented project job composes:

```text
operational result
+ optional guyed result
+ optional erection result
```

as immutable sibling results. No stage mutates `CalculationResult` after completion.

Web uses the existing single calculation Worker/controller. The Worker delegates sequencing to the application stage job and returns project input, optional stage inputs and all sibling results atomically under one job ID. Existing stale-job protection therefore prevents an old erection result from being combined with a newer operational result.

CLI uses the same application layer. `calculate` uses the canonical stage orchestration, while the explicit `erection` command exposes a deterministic JSON projection of `calculateProjectErection()` for inspection and automation. CLI contains no topology resolver or alternative angle sweep.

Desktop inherits the same generated Web application and therefore does not contain a Rust/Tauri erection solver.

## Presentation and acceptance boundary

The Web erection panel displays the already calculated envelope:

- convergence diagnostics;
- feasible/infeasible sample counts and transition brackets;
- governing cable tension and angle;
- governing displacement and angle;
- hinge force/moment envelope;
- per-member `N/V/T/M` governing demands and angles.

The presenter does not import or call structural analysis. It intentionally does **not** infer `ERECTION PASS/FAIL` from raw demands. A normative erection acceptance/utilization contract remains a separate engineering task, especially while climatic/lifting-stage rules are still research-gated.

## Verification principles

The retained tests cover:

1. hand-checkable projected moment/cable tension;
2. zero artificial gauge reaction after equilibrium;
3. global FEM equilibrium residuals;
4. invariance to operational reliability factors;
5. singular and compression-only cable geometry;
6. exact 12-DOF member-action extraction;
7. synthetic linear and interior-peak adaptive-sampling oracles;
8. refinement of feasibility boundaries;
9. fixed-world anchor invariance;
10. convergence/monotonicity of refined real-mast demand envelopes;
11. exact application-stage equivalence to independent operational/guy/erection use cases;
12. cooperative cancellation between adaptive angle evaluations;
13. one Worker/state snapshot for operational, guy and erection results;
14. CLI erection JSON equivalence to the headless application stage;
15. source-level vetoes preventing a second Web solver path or resurrection of the removed guy-only orchestrator.

Operational/canonical calculations remain a frozen veto gate for this transport work: introducing or refining erection mechanics must not alter service-state results. Deliberate future normative load-factor corrections are reviewed separately as explicit physics changes rather than hidden inside this stage integration.
