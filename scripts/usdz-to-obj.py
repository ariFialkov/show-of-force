#!/usr/bin/env python3
# Convert a (binary/crate) USDZ into an OBJ the bake pipeline can read.
# Meshes are world-transformed, faces triangulated fan-wise, and each mesh
# is emitted under its bound material name (usemtl) so the bake's
# name-keyed colouring works. three's USDZLoader can't read crate files,
# which is why this goes through Pixar's usd-core instead.
#
# Usage: python3 scripts/usdz-to-obj.py in.usdz out.obj

import sys
from pxr import Usd, UsdGeom, UsdShade, Gf

src, dst = sys.argv[1], sys.argv[2]
stage = Usd.Stage.Open(src)
xform_cache = UsdGeom.XformCache(Usd.TimeCode.Default())

out = ["# converted from " + src]
base = 1
mesh_count = 0
tri_count = 0

for prim in stage.Traverse():
    if not prim.IsA(UsdGeom.Mesh):
        continue
    mesh = UsdGeom.Mesh(prim)
    pts = mesh.GetPointsAttr().Get()
    counts = mesh.GetFaceVertexCountsAttr().Get()
    idx = mesh.GetFaceVertexIndicesAttr().Get()
    if not pts or not counts or not idx:
        continue
    m = xform_cache.GetLocalToWorldTransform(prim)

    mat_name = "default"
    binding = UsdShade.MaterialBindingAPI(prim).ComputeBoundMaterial()[0]
    if binding:
        mat_name = binding.GetPrim().GetName()

    out.append("g %s" % prim.GetName())
    out.append("usemtl %s" % mat_name)
    for p in pts:
        w = m.Transform(Gf.Vec3d(p[0], p[1], p[2]))
        out.append("v %.5f %.5f %.5f" % (w[0], w[1], w[2]))
    k = 0
    for c in counts:
        for t in range(1, c - 1):
            out.append("f %d %d %d" % (base + idx[k], base + idx[k + t], base + idx[k + t + 1]))
            tri_count += c - 2 if t == 1 else 0
        k += c
    base += len(pts)
    mesh_count += 1

with open(dst, "w") as f:
    f.write("\n".join(out) + "\n")
print("meshes=%d tris=%d -> %s" % (mesh_count, tri_count, dst))
