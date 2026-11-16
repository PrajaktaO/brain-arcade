# Pictures in puzzles

A puzzle can show one picture under its question (for example, "How many triangles?").
No database column and no server change is needed: the picture is named inside the question text.

## Steps

1. Make the picture as an SVG (best: sharp on every screen and tiny) or a PNG/WebP/JPG.
   Use a white background and dark lines, because the picture sits on a white card.
   Keep it about 300 x 270 or smaller. Name it with lowercase letters, numbers, hyphens or underscores,
   for example `triangles-13.svg`.
2. Put the file in the `images/` folder of the repository and merge it through a pull request, like any change.
3. In the puzzle's `question` column, add one line at the end:

       [[img:images/triangles-13.svg|A large triangle split into nine small triangles]]

   The text after `|` is the description read aloud by screen readers. Describe the picture without giving the answer.
4. The tag is removed from the question text and the picture is shown under it.

## Rules the app enforces

* Only files inside `images/` are accepted (`.svg`, `.png`, `.webp`, `.jpg`, `.jpeg`). Links to other sites and paths such as `../` are ignored.
* If the file is missing, the picture is hidden and the question still shows.
* Merge the picture into the live site before the puzzle's date, or players will see the question without it.

## Example SQL

    update public.daily_puzzle
    set question = 'How many triangles can you count?

    [[img:images/triangles-13.svg|A large triangle split into nine small triangles]]'
    where sequence = 99;

`images/triangles-13.svg` (a triangle made of nine small triangles; the answer is 13) is included as a ready example.
