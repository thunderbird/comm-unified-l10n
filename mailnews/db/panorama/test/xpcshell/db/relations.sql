CREATE TABLE folders (
  id INTEGER PRIMARY KEY,
  parent INTEGER REFERENCES folders(id),
  ordinal INTEGER DEFAULT NULL,
  name TEXT
);

-- These id values are deliberately out-of-order. It shouldn't matter.
INSERT INTO folders (id, parent, name) VALUES
  (3, 0, 'grandparent'),
  (6, 3, 'parent'),
  (4, 6, 'child'),
  (1, 4, 'grandchild'),
  (2, 6, 'sibling');
