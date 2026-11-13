export type DemoVisitor={
  id:string;
  fullName:string;
  contactNumber:string;
  avatarUrl:string;
};

/** Fixed demo profiles generated with Random User seed `xsponse-visitors`. */
export const DEMO_VISITORS:DemoVisitor[]=[
  {
    id:"jordan-jimenez",
    fullName:"Jordan Jimenez",
    contactNumber:"0454 071 534",
    avatarUrl:"https://randomuser.me/api/portraits/men/17.jpg",
  },
  {
    id:"connie-owens",
    fullName:"Connie Owens",
    contactNumber:"0402 694 271",
    avatarUrl:"https://randomuser.me/api/portraits/women/84.jpg",
  },
  {
    id:"rosalyn-meyer",
    fullName:"Rosalyn Meyer",
    contactNumber:"07933 917420",
    avatarUrl:"https://randomuser.me/api/portraits/women/59.jpg",
  },
  {
    id:"dolores-rhodes",
    fullName:"Dolores Rhodes",
    contactNumber:"(889) 423-8657",
    avatarUrl:"https://randomuser.me/api/portraits/women/67.jpg",
  },
  {
    id:"guy-adams",
    fullName:"Guy Adams",
    contactNumber:"07618 631077",
    avatarUrl:"https://randomuser.me/api/portraits/men/79.jpg",
  },
];
