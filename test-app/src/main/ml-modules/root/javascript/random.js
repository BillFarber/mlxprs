[
    xdmp.random()
    ,
    fn.head(fn.doc("/citations.xml"))
        .xpath("Citations").toArray()[0]
        .xpath("Citation").toArray()[0]
        .xpath("Article").toArray()[0]
        .xpath("AuthorList").toArray()[0]
        .xpath("Author").toArray()[0]
        .xpath("LastName").toArray()
]