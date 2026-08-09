# Quasi-static tilt-up erection models v1

This document describes the temporary erection mechanics introduced by #104 and the adaptive path envelope introduced by #106. These models are deliberately separate from the operational mast load case and from any future normative erection/load factors.

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

The resulting load case is solved by the real 6-DOF frame FEM. The artificial gauge reaction must then be approximately zero, while the normal free-DOF and global moment-equilibrium residuals remain within solver tolerance.

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
10. convergence/monotonicity of refined real-mast demand envelopes.

Operational/canonical calculations remain a frozen veto gate: introducing or refining erection mechanics must not alter service-state results.
