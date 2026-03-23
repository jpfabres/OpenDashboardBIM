"""
Stub for Blender's mathutils module.
Allows ifcopenshell.api to be imported outside a Blender environment.
"""


class Vector:
    def __init__(self, *args, **kwargs): pass
    def __iter__(self): return iter([])
    def __mul__(self, other): return self
    def __rmul__(self, other): return self
    def __add__(self, other): return self
    def __sub__(self, other): return self
    def __getitem__(self, i): return 0.0
    def __setitem__(self, i, v): pass
    def __len__(self): return 3
    def freeze(self): return self
    def copy(self): return Vector()
    def normalized(self): return self
    def to_tuple(self, *a): return (0.0, 0.0, 0.0)
    def cross(self, other): return Vector()
    def dot(self, other): return 0.0


class Matrix:
    def __init__(self, *args, **kwargs): pass

    @staticmethod
    def Identity(size):
        return Matrix()

    def __matmul__(self, other): return self
    def __mul__(self, other): return self
    def to_translation(self): return Vector()
    def to_quaternion(self): return Quaternion()


class Quaternion:
    def __init__(self, *args, **kwargs): pass
    def to_matrix(self): return Matrix()
    def to_euler(self, *args): return Euler()


class Euler:
    def __init__(self, *args, **kwargs): pass
    def to_matrix(self): return Matrix()
    def to_quaternion(self): return Quaternion()


class Color:
    def __init__(self, *args, **kwargs): pass
